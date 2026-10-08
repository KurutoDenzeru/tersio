// Model ids carry their provider in different places, so one rule decides it for the whole app.
// Lives here rather than in the ledger because pricing needs it and the ledger imports pricing.

/** Model ids that name the agent, not the provider, when a further segment follows. */
const AGENT_NAMESPACES = new Set(['opencode', 'codex']);

/**
 * `omp` writes "apmixai/deepseek-v4-flash-free" with no provider field, so the leading segment is the
 * provider. `opencode` nests it as "opencode/<provider>/<model>", so the agent namespace is skipped.
 */
export function providerOf(model: string): string | undefined {
  const segs = model.split('/');
  if (segs.length < 2) return undefined;
  return AGENT_NAMESPACES.has(segs[0]) && segs.length > 2 ? segs[1] : segs[0];
}

/** Every suffix of a model id, longest first, plus its bare tail. Used to match catalog keys. */
export function modelCandidates(model: string): string[] {
  const lower = model.toLowerCase();
  const segs = lower.split('/').filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < segs.length; i++) out.push(segs.slice(i).join('/'));
  if (segs.length > 1) out.push(segs[segs.length - 1]);
  return [...new Set(out)];
}
