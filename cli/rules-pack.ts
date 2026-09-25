// cli/rules-pack.ts — the portable half of Tersio's modes, as data.
//
// OMP injects modes through a live bridge and can switch mid-session. Every
// other host reads static files at startup. Combo state, status bar, and the
// bridge have no portable equivalent, so they stay OMP-only.

/** Marker pair shared by every host file we write. */
const START = '<!-- tersio:start -->';
const END = '<!-- tersio:end -->';

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

const CAVEMAN_COMMAND_BODY = `${CAVEMAN.replace(/^## Caveman \(terse replies\)\n\n/, '')}
Switch levels with \`/caveman <level>\`: lite, full, ultra.`;

const PONYTAIL_COMMAND_BODY = `${PONYTAIL.replace(/^## Ponytail \(minimal code\)\n\n/, '')}
Switch levels with \`/ponytail <level>\`: lite, full, ultra.`;

const RTK_COMMAND_BODY = `${RTK.replace(/^## Rust Token Killer \(rtk\)\n\n/, '')}
Native tool calls (read/edit/glob/grep) stay unmetered — only shell commands
pass through rtk.`;

/** The portable rules body, shared by every markdown-instruction host. */
export function rulesBody(): string {
  return [CAVEMAN, PONYTAIL, RTK].join('\n\n');
}

/** Slash-command bodies, keyed by mode, for hosts that expose modes as commands. */
export function packCommands(): Record<string, string> {
  return {
    caveman: CAVEMAN_COMMAND_BODY,
    ponytail: PONYTAIL_COMMAND_BODY,
    rtk: RTK_COMMAND_BODY,
  };
}

export { START, END, CAVEMAN, PONYTAIL, RTK };
