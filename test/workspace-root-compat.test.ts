import { afterEach, describe, expect, it } from "bun:test"
import path from "node:path"
import {
  clearSessionDirectories,
  getSessionDirectory,
  markSessionDirectory,
} from "../src/session-directory.js"

/**
 * Mirrors `language-model.ts` workspace root resolution so classic OpenCode 1.x
 * (`options.workspaceRoot` from `input.directory`) and OpenCode 2.0
 * (`getSessionDirectory` from `session.hook("context")`) stay compatible on the
 * shared LM path without either host clobbering the other.
 */
function resolveWorkspaceRoot(
  sessionKey: string | undefined,
  optionsWorkspaceRoot: string | undefined,
  cwd: string,
  headers?: Record<string, string | undefined>,
): string {
  const headerDir = (() => {
    const h = headers ?? {}
    const raw = h["x-opencode-directory"] ?? h["X-Opencode-Directory"] ?? h["x-opencode-dir"]
    if (typeof raw === "string" && raw.trim().length > 0) {
      try {
        return decodeURIComponent(raw.trim())
      } catch {
        return raw.trim()
      }
    }
    return undefined
  })()
  return path.resolve(
    headerDir ?? getSessionDirectory(sessionKey) ?? (optionsWorkspaceRoot || cwd),
  )
}

afterEach(() => {
  clearSessionDirectories()
})

describe("v1 / OpenCode 2.0 workspace root compatibility", () => {
  it("classic v1: empty session map uses options.workspaceRoot (input.directory)", () => {
    const project = "/workspace/my-app"
    expect(getSessionDirectory("ses_classic")).toBeUndefined()
    expect(resolveWorkspaceRoot("ses_classic", project, "/workspace")).toBe(
      path.resolve(project),
    )
  })

  it("classic v1: never consults a foreign session mark", () => {
    markSessionDirectory("ses_opencode2", "/other/project")
    const project = "/workspace/my-app"
    expect(resolveWorkspaceRoot("ses_classic", project, "/workspace")).toBe(
      path.resolve(project),
    )
  })

  it("OpenCode 2.0: session mark wins over static createSdk cwd fallback", () => {
    markSessionDirectory("ses_2", "/home/user/projects/my-app")
    expect(
      resolveWorkspaceRoot("ses_2", "/workspace", "/workspace"),
    ).toBe(path.resolve("/home/user/projects/my-app"))
  })

  it("OpenCode 2.0: before context hook, falls back to options then cwd", () => {
    expect(resolveWorkspaceRoot("ses_new", "/workspace", "/workspace")).toBe(
      path.resolve("/workspace"),
    )
    expect(resolveWorkspaceRoot("ses_new", undefined, "/tmp/daemon")).toBe(
      path.resolve("/tmp/daemon"),
    )
  })

  it("OpenCode 2.0: x-opencode-directory header wins over session marks and fallback", () => {
    markSessionDirectory("ses_header", "/session/mark/dir")
    expect(
      resolveWorkspaceRoot("ses_header", "/workspace", "/workspace", {
        "x-opencode-directory": encodeURIComponent("/custom/header/project"),
      }),
    ).toBe(path.resolve("/custom/header/project"))
  })
})
