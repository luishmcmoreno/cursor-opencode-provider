import { describe, expect, it } from "bun:test"
import { encodeMessage } from "../src/protocol/messages.js"
import {
  cancelPendingExecsForFreshTurn,
  drainSessionUntilTurnEnded,
  FRESH_TURN_PENDING_CANCEL_REASON,
  preparePriorSessionForFreshTurn,
} from "../src/language-model.js"
import { sessionManager, type CursorSession } from "../src/session.js"

function turnEndedPayload(inputTokens: number, cacheRead: number): Uint8Array {
  return encodeMessage("AgentServerMessage", {
    interaction_update: {
      turn_ended: {
        input_tokens: inputTokens,
        output_tokens: 3,
        cache_read: cacheRead,
        cache_write: 0,
        reasoning_tokens: 0,
      },
    },
  })
}

function fakeSessionWithPayloads(payloads: Uint8Array[]): CursorSession {
  let index = 0
  const written: Uint8Array[] = []
  const conversationId = `conv_drain_${Date.now()}_${Math.random().toString(16).slice(2)}`
  const session: CursorSession = {
    sessionId: `sess_drain_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    conversationId,
    openCodeSessionId: `opencode-fresh-turn-${Math.random().toString(16).slice(2)}`,
    stream: {
      write(frame: Uint8Array) { written.push(frame); return true },
      end() {},
      frames: () => ({
        [Symbol.asyncIterator]: () => ({
          next: async () => ({ done: true as const, value: undefined }),
        }),
      }),
      destroy() {},
      isClosed: () => false,
    } as never,
    frames: {
      next: async () => {
        if (index >= payloads.length) return { done: true as const, value: undefined }
        const payload = payloads[index++]!
        return {
          done: false as const,
          value: { flags: 0, payload },
        }
      },
    } as never,
    pending: new Map(),
    displayToolCalls: new Map(),
    nextBridgedExecId: 900_000,
    blobs: new Map(),
    toolDescriptors: [],
    requestContext: {},
    usageEstimate: { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, reasoningTokens: 0 },
    allowTools: true,
    pumpActive: false,
    heartbeat: null,
    expiresAt: Date.now() + 10_000,
    cacheDiagnostics: {
      sessionKey: "opencode-fresh-turn",
      conversationId,
      startedWithCheckpoint: true,
      requestContextReused: true,
      requestContextHash: "abc",
      checkpointUpdates: 0,
      tokenDetailUpdates: 0,
      pumpPasses: 1,
      stepStarts: 0,
      stepCompletes: 0,
      displayToolCalls: 0,
      execRequests: 0,
      priorTokenDetails: { usedTokens: 1000, maxTokens: 256_000 },
    },
  }
  ;(session as CursorSession & { _written: Uint8Array[] })._written = written
  sessionManager.registerSession(session)
  return session
}

describe("fresh-turn prior drain", () => {
  it("settles bridged pending and drains turn_ended before a fresh turn", async () => {
    const session = fakeSessionWithPayloads([turnEndedPayload(5000, 4000)])
    sessionManager.registerPending(900_000, session, "bridged", "todowrite", true)
    expect(session.pending.size).toBe(1)

    const outcome = await preparePriorSessionForFreshTurn(session.openCodeSessionId, {
      timeoutMs: 1_000,
    })
    expect(outcome).toBe("drained")
    expect(session.closed).toBe(true)
    expect(session.pending.size).toBe(0)
  })

  it("cancels a real pending exec then drains turn_ended instead of superseding mid-tool", async () => {
    const session = fakeSessionWithPayloads([turnEndedPayload(100, 80)])
    sessionManager.registerPending(1, session, "read_result", "read", false)
    expect(session.pending.size).toBe(1)

    const outcome = await preparePriorSessionForFreshTurn(session.openCodeSessionId, {
      timeoutMs: 1_000,
    })
    expect(outcome).toBe("drained")
    expect(session.closed).toBe(true)
    expect(session.pending.size).toBe(0)
    const written = (session as CursorSession & { _written: Uint8Array[] })._written
    expect(written.length).toBeGreaterThan(0)
  })

  it("cancelPendingExecsForFreshTurn writes an error result for each open exec", () => {
    const session = fakeSessionWithPayloads([])
    sessionManager.registerPending(0, session, "grep_result", "grep", false)
    sessionManager.registerPending(1, session, "read_result", "read", false)
    expect(cancelPendingExecsForFreshTurn(session)).toBe(2)
    expect(session.pending.size).toBe(0)
    expect(session.closed).toBe(false)
    const written = (session as CursorSession & { _written: Uint8Array[] })._written
    expect(written.length).toBeGreaterThanOrEqual(2)
    const blob = Buffer.concat(written.map((f) => Buffer.from(f))).toString("utf8")
    expect(blob).toContain(FRESH_TURN_PENDING_CANCEL_REASON)
    sessionManager.close(session, "ordinary-cleanup")
  })

  it("drainSessionUntilTurnEnded times out when Cursor stays silent", async () => {
    const session = fakeSessionWithPayloads([])
    let resolveNext: ((value: IteratorResult<{ flags: number; payload: Uint8Array }>) => void) | undefined
    session.frames = {
      next: () => new Promise((resolve) => {
        resolveNext = resolve
      }),
    } as never
    const outcome = await drainSessionUntilTurnEnded(session, { timeoutMs: 40 })
    expect(outcome).toBe("timeout")
    expect(session.closed).toBe(false)
    resolveNext?.({ done: true, value: undefined })
    sessionManager.close(session, "ordinary-cleanup")
  })
})
