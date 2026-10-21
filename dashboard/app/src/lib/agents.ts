// Agents Tersio does not install into yet. The connection list and the Upstream table both name
// them, so the pair lives here rather than in each surface.
export interface UpcomingAgent {
  /** The id `AgentLogo` resolves a mark from. */
  id: string;
  name: string;
  /** The binary a future install would look for on PATH. */
  bin: string;
  docs: string;
}

export const UPCOMING_AGENTS: readonly UpcomingAgent[] = [
  { id: "claude-code", name: "Claude Code", bin: "claude", docs: "https://claude.com/claude-code" },
  { id: "codex", name: "Codex", bin: "codex", docs: "https://github.com/openai/codex" },
];
