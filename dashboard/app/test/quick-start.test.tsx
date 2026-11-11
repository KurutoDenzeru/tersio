// Guards the quick start status rules: Claude Code is one host id everywhere, and its install state owns its card.
import { render } from "@testing-library/react"
import { describe, expect, test } from "vitest"
import { AgentLogo } from "../src/components/agent-logos"
import { edgeLit, versionOf } from "../src/components/agents/pipeline-model"
import type { HostState } from "../src/components/agents/pipeline-model"

const hostState = (installed: Record<string, boolean>): HostState => ({
  installed,
  present: {},
  versions: {},
  modeVersions: {},
})

describe("quick start hosts", () => {
  test("a claude install reads its own state, never a mode default", () => {
    expect(edgeLit("claude", null, hostState({ claude: true }))).toBe(true)
    expect(edgeLit("claude", null, hostState({ claude: false }))).toBe(false)
    expect(edgeLit("claude", null, hostState({}))).toBe(null)
  })

  test("claude's own mark replaces the pi fallback", () => {
    const { container } = render(<AgentLogo host="claude" className="size-4" />)
    expect(container.innerHTML).toContain("claudecode")
    expect(container.querySelector("svg")).toBeNull()
  })

  test("the claude version label drops its product suffix", () => {
    expect(versionOf("claude/2.1.322 (Claude Code)")).toBe("2.1.322")
  })
})
