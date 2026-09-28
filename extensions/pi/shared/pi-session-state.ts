// Pi's view of the host-free mode state in extensions/shared/.
export * from '../../shared/session-state.ts';
import type { ExtensionCtx } from './pi-types.ts';

// One section per extension, so two never overwrite each other.
export function injectPiSection(
  event: { systemPromptOptions?: { sections?: Record<string, unknown> } | null } | null | undefined,
  section: string,
  text: string,
): void {
  const sections = event?.systemPromptOptions?.sections;
  if (!sections || typeof sections !== 'object') return;
  sections[section] = text;
}

// Guarded: a mode switch in a non-TUI run must not throw and take the handler.
export function notify(ctx: ExtensionCtx | undefined, message: string, level: 'info' | 'warning' = 'info'): void {
  ctx?.ui?.notify?.(message, level);
}

export type { ExtensionCtx };
