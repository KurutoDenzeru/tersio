// extensions/pi/rtk-session/index.ts — rtk mode on Pi.
//
// Port of extensions/rtk-session/index.ts. Same on/off semantics, same /rtk
// command, the same `rtk` status key, the same combo-preset suppression, the
// same RTK_DISABLED process flag, the same restore precedence, and the same
// `rtk_run` tool. What changed is the four Pi API facts that touch this file:
//
//   - Prompt injection. OMP returned `{ systemPrompt: [...base, RTK_PROMPT] }`.
//     Pi's BeforeAgentStartEvent.systemPrompt is a rendered read-only string and
//     returning it replaces the entire prompt for the turn, so the guidance goes
//     into this file's own sealed section of the mutable
//     `systemPromptOptions.sections`; disabled writes '' (Pi omits falsy content)
//     rather than leaving a stale section behind.
//   - Tool schema. OMP built the schema with the host's bundled zod
//     (`pi.zod.z`). Pi requires a typebox TSchema and hands `typebox` to an
//     extension, but this package is loaded from a user config dir that has no
//     node_modules, so it cannot depend on one. The JSON-Schema-shaped literal
//     below is the same schema zod described, cast once to PiToolParameters.
//   - Tool errors. OMP signalled failure by returning `{ isError: true }`.
//     Pi's contract is the opposite: throwing from execute() produces a failed
//     tool result, and returning an object does not mark it as an error. So the
//     disabled-mode gate and a non-zero exit both throw.
//   - There is no session_branch in Pi, and no `pi.cwd` (the working directory
//     is ctx.cwd), and `pi.setLabel('RTK session toggle')` has no equivalent —
//     Pi's setLabel is setLabel(entryId, label), which labels a session entry for
//     bookmarks, a different thing entirely, so it is dropped.
//   - pi.exec(command, args, {signal, cwd}) is identical on Pi, so the exec
//     call is unchanged; only the cwd source moved from `ctx?.cwd || pi.cwd` to
//     `ctx?.cwd`, because pi.cwd does not exist.

import {
  activeModesSummary,
  getSharedComboState,
  injectPiSection,
  isComboPresetActive,
  lastCustomValue,
  notify,
  normalizeInputCommand,
  paintStatusBar,
  paintableCtx,
  reconcileSharedComboEntries,
  sessionEntries,
  setSharedComboListener,
  setSharedComboMode,
} from '../shared/pi-session-state.ts';
// The installer writes the same ~/.tersio/settings.json for every host, and the
// specifiers below are the ones this file uses once installed, where
// extensions/shared/ sits beside the extension directories.
import { readRtkDefault } from '../shared/plugin-settings.ts';
import type { ExtensionCtx, PiBeforeAgentStartEvent, PiExtensionAPI, PiInputEvent, PiToolParameters, SessionEntry } from '../shared/pi-types.ts';

// Pi requires lowercase alphanumerics, dashes, and underscores in a section
// name, and wraps every non-empty one in matching XML tags. Sealed: this file
// writes `tersio-rtk` and nothing else.
const SECTION = 'tersio-rtk';

const DEFAULT_ENABLED = false;

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'on' || value === 'true') return true;
  if (value === 'off' || value === 'false') return false;
  return null;
}

function resolveEnabled(entries: SessionEntry[] | null | undefined): boolean | null {
  return lastCustomValue(entries, 'rtk-mode', (data) => asBoolean(data?.enabled));
}

function setRtkProcessEnabled(enabled: boolean): void {
  if (enabled) delete process.env.RTK_DISABLED;
  else process.env.RTK_DISABLED = '1';
}

const RTK_PROMPT = `RTK guidance active. RTK automatically rewrites eligible Bash calls through the installed rtk hook. Prefer rtk for noisy shell output, but use exact raw output for state changes, checksums, patches, and diagnostics that need full bytes.`;

// Cast once, deliberately: Pi's ToolDefinition.parameters is a typebox TSchema
// and Pi supplies `typebox` to extensions, but this module is loaded by jiti from
// ~/.pi/agent/extensions where there is no node_modules to resolve a typebox
// import from. The literal is the JSON Schema zod's z.object({ args: z.array(
// z.string()).min(1) }) described, which is what the tool arguments are
// validated against.
const RTK_PARAMS = {
  type: 'object',
  properties: {
    args: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      description: "Arguments passed to rtk, e.g. ['git','status'] or ['read','src/index.ts']",
    },
  },
  required: ['args'],
} as PiToolParameters;

export default function rtkSessionExtension(pi: PiExtensionAPI): void {
  let enabled = DEFAULT_ENABLED;
  let isActive = false;
  let lastCtx: ExtensionCtx | undefined = undefined;

  function syncStatus(ctx?: ExtensionCtx): void {
    // Pi's footer is terminal-only, and its docs prescribe ctx.mode === 'tui'
    // for that class of UI. An absent mode (a context built by something other
    // than a real Pi run) still paints, so this is no stricter than OMP's own
    // setStatus probe.
    if (ctx && ctx.mode !== undefined && ctx.mode !== 'tui') return;
    lastCtx = paintableCtx(lastCtx, ctx);
    const c = lastCtx;
    if (!c?.ui?.setStatus) return;
    // Combo owns the bar when any preset is active; keep ours empty to avoid duplication.
    if (isComboPresetActive() || !enabled) {
      c.ui.setStatus('rtk', undefined);
      return;
    }
    // The theme comes from the context actually being painted, not from the
    // incoming one: paintableCtx keeps the last context that could paint, so
    // the two differ on a turn that arrives without a UI.
    paintStatusBar(c.ui, 'rtk', '⚡', 'rtk: ON', isActive, c.ui.theme);
  }

  function setEnabled(next: unknown, ctx?: ExtensionCtx): void {
    enabled = Boolean(next);
    pi.appendEntry?.('rtk-mode', { enabled });
    setSharedComboMode('rtk', enabled);
    setRtkProcessEnabled(enabled);
    const active = activeModesSummary(getSharedComboState());
    notify(ctx, enabled ? `RTK on — compact shell output for this session. Active: ${active}.` : `RTK off. Active: ${active}.`);
  }

  // Live mirror: a /tersio or /combo switch publishes shared state — adopt
  // it at once so the next turn and the rtk_run gate see it, no reload. The
  // bridge is a process-global symbol rather than pi.events: one Pi process is
  // one realm, so this stays a synchronous read instead of an async handshake
  // on every turn.
  function syncFromShared(state: { rtk: string }): void {
    enabled = state.rtk === 'on';
    setRtkProcessEnabled(enabled);
    syncStatus();
  }
  setSharedComboListener(syncFromShared);
  pi.registerCommand?.('rtk', {
    description: 'Toggle RTK compact shell-output guidance for this session',
    handler: async (args, ctx) => {
      const arg = String(args || '').trim().toLowerCase();
      if (!arg || arg === 'status') {
        notify(ctx, `RTK: ${enabled ? 'on' : 'off'}`);
        return;
      }
      if (['on', 'enable', 'enabled', 'true'].includes(arg)) {
        setEnabled(true, ctx);
        return;
      }
      if (['off', 'disable', 'disabled', 'false'].includes(arg)) {
        setEnabled(false, ctx);
        return;
      }
      notify(ctx, 'Usage: /rtk [on|off|status]', 'warning');
    },
  });

  pi.registerTool?.({
    name: 'rtk_run',
    label: 'RTK Run',
    description: 'Run the installed `rtk` binary for compact command output when RTK mode is enabled.',
    parameters: RTK_PARAMS,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      // Throw, not return { isError: true }: that is OMP's spelling, and Pi
      // documents the opposite contract — a thrown error becomes a failed tool
      // result while a returned object is a success.
      if (!enabled) {
        throw new Error('RTK mode is off. Run /rtk on for this session, or use bash explicitly.');
      }
      onUpdate?.({ content: [{ type: 'text', text: `rtk ${params.args.join(' ')}` }], details: { phase: 'start' } });
      const result = await pi.exec?.('rtk', params.args, { signal, cwd: ctx?.cwd });
      if (!result) throw new Error('Pi exposes no exec() to this extension, so rtk cannot run.');
      const text = [result.stdout, result.stderr].filter(Boolean).join('\n');
      // A non-zero exit is a failed run, not a result to render: stderr here is
      // rtk's own output (a read error, an unknown subcommand), and the model
      // must see it as a failure rather than as a successful transcript.
      if (result.code !== 0) {
        throw new Error(text || `rtk exited ${result.code}`);
      }
      return {
        content: [{ type: 'text', text: text || `rtk exited ${result.code}` }],
        details: { code: result.code, killed: result.killed, enabled },
      };
    },
  });

  pi.on?.('input', (event) => {
    const e = event as PiInputEvent;
    if (e?.source === 'extension') return;
    const t = normalizeInputCommand(e?.text);
    if (t === 'rtk on' || t === 'use rtk') setEnabled(true);
    if (t === 'rtk off' || t === 'stop rtk') setEnabled(false);
  });

  function restoreEnabled(ctx?: ExtensionCtx): void {
    const entries = sessionEntries(ctx);
    // Publish the persisted combo state (incl. combo-level) before painting:
    // bar suppression reads the in-process bridge, which is empty in a fresh
    // host until the combo extension reconciles — and its reconcile is
    // UI-gated. Deriving it here makes suppression independent of load order.
    reconcileSharedComboEntries(entries);
    // Persisted session state wins; a fresh session falls back to the
    // installer/user-configured default (off unless configured).
    const persisted = resolveEnabled(entries);
    enabled = typeof persisted === 'boolean' ? persisted : readRtkDefault();
    setRtkProcessEnabled(enabled);
    syncStatus(ctx);
  }

  pi.on?.('session_start', (_event, ctx) => {
    restoreEnabled(ctx);
    notify(ctx, `RTK loaded: ${enabled ? 'on' : 'off'}`);
  });

  // session_branch is an OMP event with no Pi counterpart; session_tree is the
  // other event that fires when the active conversation changes.
  pi.on?.('session_tree', (_event, ctx) => {
    restoreEnabled(ctx);
  });

  pi.on?.('agent_start', (_event, ctx) => {
    isActive = true;
    syncStatus(ctx);
  });

  pi.on?.('agent_end', (_event, ctx) => {
    isActive = false;
    syncStatus(ctx);
  });

  pi.on?.('before_agent_start', (event) => {
    const e = event as PiBeforeAgentStartEvent;
    // Always write the section, empty when off: Pi omits falsy content, so the
    // mode switches off in one write instead of leaving a stale section for the
    // next turn to inherit. No return value — returning systemPrompt would
    // replace the whole prompt on Pi.
    injectPiSection(e, SECTION, enabled ? RTK_PROMPT : '');
  });
}
