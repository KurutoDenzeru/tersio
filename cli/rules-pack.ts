// cli/rules-pack.ts — the portable half of Tersio's modes, as data.
//
// OMP injects modes through a live bridge and can switch them mid-session.
// Every other host reads static files. Combo state, the status bar, and the
// bridge have no portable equivalent, so they stay OMP-only.
//
// Deliberately free of cli/common.ts imports (argv side effects) so tests can
// load it directly.

/** Marker pair shared by every host file we merge into. */
const START = '<!-- tersio:start -->';
const END = '<!-- tersio:end -->';

/**
 * Generic marked-block editing, shared by every host file we merge into.
 * A file without markers is the user's to own, so we only ever touch the span
 * between a matching pair. Terse-owned files (a skill, a `.mdc` rule) do not
 * need markers at all and are written whole.
 */
export function applyMarkedBlock(existing: string | null, block: string, start: string, end: string): string {
  const base = existing ?? '';
  if (!base.trim()) return block;
  const from = base.indexOf(start);
  const to = base.indexOf(end);
  if (from !== -1 && to !== -1 && to > from) {
    const before = base.slice(0, from);
    const after = base.slice(to + end.length).replace(/^\n/, '');
    return `${before}${block.trimEnd()}${after ? `\n${after}` : '\n'}`;
  }
  const prefix = base.endsWith('\n') ? '' : '\n';
  return `${base}${prefix}\n${block}`;
}

/** Removes the block and the blank line it introduced. Null when nothing is left. */
export function removeMarkedBlock(existing: string, start: string, end: string): string | null {
  const from = existing.indexOf(start);
  const to = existing.indexOf(end);
  if (from === -1 || to === -1 || to <= from) return existing;
  const before = existing.slice(0, from).replace(/\n+$/, '\n');
  const after = existing.slice(to + end.length).replace(/^\n+/, '');
  const merged = `${before}${after}`;
  return merged.trim() ? merged : null;
}

const CAVEMAN = `## Caveman (terse replies)

Respond concise. Drop pleasantries, filler, and hedging. Keep complete technical
substance. Code, commands, paths, errors, commits, and PR text stay normal and
exact. Use normal prose for security warnings, irreversible actions, and
multi-step sequences where a fragment could be misread.`;

const PONYTAIL = `## Ponytail (minimal code)

Use the minimum correct solution. Delete or reuse before adding. Understand the
path first and fix root causes, not symptoms. Prefer the standard library and
YAGNI. Avoid speculative abstractions and dependencies. Preserve correctness and
verify changed behavior.`;

const RTK = `## Rust Token Killer (rtk)

Use \`rtk\` for noisy shell commands. It filters output before the model reads it.
Call the explicit commands: \`rtk git status\`, \`rtk git diff\`,
\`rtk grep <pattern> <path>\`, \`rtk find <path>\`, \`rtk read <file>\`,
\`rtk ls <path>\`, \`rtk test <cmd>\`, \`rtk deps\`.
Do not use rtk for exact bytes: patches, checksums, state changes, and diffs you
must read verbatim.`;

/**
 * RTK guidance for hosts whose hooks cannot rewrite a command (OpenClaw, agy).
 * Says what to do by hand, and never claims an automatic rewrite happened.
 */
export const RTK_GUIDANCE = `## Rust Token Killer (rtk) — manual

This host cannot rewrite shell commands automatically, so prefix noisy commands
yourself: \`rtk git status\`, \`rtk git diff\`, \`rtk grep <pattern> <path>\`,
\`rtk find <path>\`, \`rtk read <file>\`, \`rtk ls <path>\`, \`rtk test <cmd>\`,
\`rtk deps\`. Do not use rtk for exact bytes: patches, checksums, state changes,
and diffs you must read verbatim.`;

function bodyWithoutHeading(text: string): string {
  return text.replace(/^##[^\n]*\n\n/, '');
}

const CAVEMAN_COMMAND_BODY = `${bodyWithoutHeading(CAVEMAN)}
Switch levels with \`/caveman <level>\`: lite, full, ultra.`;

const PONYTAIL_COMMAND_BODY = `${bodyWithoutHeading(PONYTAIL)}
Switch levels with \`/ponytail <level>\`: lite, full, ultra.`;

const RTK_COMMAND_BODY = `${bodyWithoutHeading(RTK)}
Native tool calls (read/edit/glob/grep) stay unmetered — only shell commands
pass through rtk.`;

/**
 * The prompt-only tier of `/combo`, for hosts with no live session bridge.
 * Wording is deliberate: it says the level is in effect *for this session*
 * rather than claiming a state switch that nothing performed.
 */
export const COMBO_PROMPT_BODY = `## Combo — active for this session

Combo level: $LEVEL (caveman=$CAVEMAN, rtk=$RTK, ponytail=$PONYTAIL).

These are in effect for the rest of this session only. Nothing is persisted, and
a host-side \`tersio status\` will not report a combo level, because this host
cannot switch modes mid-session. Re-invoke this command to change the level.`;

/** The portable rules body, shared by every markdown-instruction host. */
export function rulesBody(): string {
  return [CAVEMAN, PONYTAIL, RTK].join('\n\n');
}

/** The rules body for a host that cannot auto-rewrite, swapping in the manual text. */
export function guidanceRulesBody(): string {
  return [CAVEMAN, PONYTAIL, RTK_GUIDANCE].join('\n\n');
}

/** Slash-command bodies, keyed by mode, for hosts that expose modes as commands. */
export function packCommands(): Record<string, string> {
  return {
    caveman: CAVEMAN_COMMAND_BODY,
    ponytail: PONYTAIL_COMMAND_BODY,
    rtk: RTK_COMMAND_BODY,
  };
}

/** Fills the prompt-only combo body with a concrete level. */
export function comboPrompt(level: string, modes: { caveman: string; rtk: string; ponytail: string }): string {
  return COMBO_PROMPT_BODY
    .replace('$LEVEL', level)
    .replace('$CAVEMAN', modes.caveman)
    .replace('$RTK', modes.rtk)
    .replace('$PONYTAIL', modes.ponytail);
}

export { START, END, RTK, CAVEMAN, PONYTAIL };
