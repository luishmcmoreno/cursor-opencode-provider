import { afterEach, describe, expect, test } from "bun:test"
import {
  dispatchHostEventBridge,
  HOST_EVENT_BRIDGE,
} from "../src/host-event-bridge.js"

const root = globalThis as typeof globalThis & Record<typeof HOST_EVENT_BRIDGE, unknown>

afterEach(() => {
  delete root[HOST_EVENT_BRIDGE]
})

describe("host event bridge", () => {
  test("forwards canonical plugin context to an installed structural capability", async () => {
    const received: unknown[] = []
    root[HOST_EVENT_BRIDGE] = {
      handle(input: unknown) {
        received.push(input)
      },
    }
    const event = { type: "message.part.updated", properties: { part: { type: "step-finish" } } }
    const client = { session: {} }
    const serverUrl = new URL("http://127.0.0.1:4096")

    await dispatchHostEventBridge({ event, client, directory: "/workspace", serverUrl })

    expect(received).toEqual([{ event, client, directory: "/workspace", serverUrl }])
  })

  test("is optional and cannot break the native plugin", async () => {
    root[HOST_EVENT_BRIDGE] = {
      handle() {
        throw new Error("compatibility failure")
      },
    }

    await expect(dispatchHostEventBridge({
      event: { type: "session.updated" },
      client: {},
      directory: "/workspace",
      serverUrl: new URL("http://127.0.0.1:4096"),
    })).resolves.toBeUndefined()
  })
})
