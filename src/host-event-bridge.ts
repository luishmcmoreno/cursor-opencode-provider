/**
 * Optional host-neutral event capability installed by a compatibility layer.
 *
 * The provider does not interpret host-specific event payloads here. It only
 * forwards the canonical OpenCode plugin event and the structural host values
 * that were supplied to the plugin at load time.
 */
export const HOST_EVENT_BRIDGE = Symbol.for("opencode.host.event-bridge")

export type HostEventBridge = {
  handle(input: {
    event: unknown
    client: unknown
    directory: string
    serverUrl: URL
  }): void | Promise<void>
}

export async function dispatchHostEventBridge(input: {
  event: unknown
  client: unknown
  directory: string
  serverUrl: URL
}): Promise<void> {
  const bridge = (globalThis as typeof globalThis & Record<typeof HOST_EVENT_BRIDGE, unknown>)[HOST_EVENT_BRIDGE]
  if (!bridge || typeof bridge !== "object") return
  const handle = (bridge as { handle?: unknown }).handle
  if (typeof handle !== "function") return
  try {
    await handle.call(bridge, input)
  } catch {
    // An optional compatibility capability must not break the native plugin.
  }
}
