// extensions/omp/omp-prompt.ts — OMP's system-prompt surface.
//
// OMP hands an extension the built prompt as `string | string[]` and takes back
// a replacement of the same shape, so appending to it is a return value. Pi
// does not: its prompt is a rendered read-only string and the injection point
// is `event.systemPromptOptions.sections`. These helpers therefore belong to
// the OMP ports alone, which is why they live apart from the host-agnostic
// session state in ./session-state.ts.

// The subagent marker OMP puts in a delegated agent's prompt. A mode must
// follow the parent's combo level there rather than its own local state.
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
