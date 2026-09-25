// cli/rules-pack.ts — single source for the portable half of Tersio's modes.
//
// The OMP host injects mode text through a live session bridge, so it can
// switch modes mid-session. Every other host in issue #17 loads static
// instruction files at session start, so they get a rules pack instead: one
// canonical body of text rendered per host, written with idempotent markers so
// reinstall replaces the block and never duplicates it.
//
// What is portable and what is not:
//   - Caveman, Ponytail, and RTK guidance are prose. They port verbatim.
//   - Combo state, the status bar, and the in-process bridge are host
//     machinery with no portable equivalent. They stay OMP-only and are
//     deliberately absent here rather than faked.
//
// Content lives here as data so `cli/agents.ts` can render it without
// importing the OMP extension sources, which carry side effects and read
// ~/.omp on load.

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

/**
 * Some hosts enable a mode by a command instead of a rules file. When a host
 * gets a slash command, this is its body.
 */
const RTK_COMMAND_BODY = `${RTK.replace(/^## Rust Token Killer \(rtk\)\n\n/, '')}
Native tool calls (read/edit/glob/grep) stay unmetered — only shell commands
pass through rtk.`;

const CAVEMAN_COMMAND_BODY = `${CAVEMAN.replace(/^## Caveman \(terse replies\)\n\n/, '')}
Switch levels with \`/caveman <level>\`: lite, full, ultra.`;

const PONYTAIL_COMMAND_BODY = `${PONYTAIL.replace(/^## Ponytail \(minimal code\)\n\n/, '')}
Switch levels with \`/ponytail <level>\`: lite, full, ultra.`;

export interface RulesPack {
  /** The full instruction body, already rendered for a markdown host. */
  body: string;
  /** Slash-command bodies, keyed by command name. */
  commands: Record<string, string>;
}

/** The portable rules body, shared by every markdown-instruction host. */
export function rulesBody(): string {
  return [CAVEMAN, PONYTAIL, RTK].join('\n\n');
}

export function packCommands(): Record<string, string> {
  return {
    caveman: CAVEMAN_COMMAND_BODY,
    ponytail: PONYTAIL_COMMAND_BODY,
    rtk: RTK_COMMAND_BODY,
  };
}

/**
 * Wraps a body in markers so a later run can replace exactly this block and
 * leave the rest of the user's file untouched.
 */
export function markedBlock(body: string): string {
  return `${START}\n\n${body}\n\n${END}\n`;
}

export { START, END, CAVEMAN, PONYTAIL, RTK };
