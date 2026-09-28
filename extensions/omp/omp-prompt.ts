// extensions/omp/omp-prompt.ts — OMP's system-prompt surface.

// The subagent marker OMP puts in a delegated agent's prompt.
export const OMP_SUBAGENT_MARKER = 'You are operating on a piece of work assigned to you by the main agent.';

export function asPromptArray(systemPrompt: string | string[]): string[] {
  return Array.isArray(systemPrompt) ? systemPrompt : [systemPrompt];
}

export function systemPromptIncludes(systemPrompt: string | string[], marker: string): boolean {
  return asPromptArray(systemPrompt).some((prompt) => typeof prompt === 'string' && prompt.includes(marker));
}

export function isOmpSubagentPrompt(systemPrompt: string | string[]): boolean {
  return systemPromptIncludes(systemPrompt, OMP_SUBAGENT_MARKER);
}
