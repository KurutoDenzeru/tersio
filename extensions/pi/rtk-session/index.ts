// rtk mode on Pi. Port of extensions/omp/rtk-session/index.ts.

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
import { readRtkDefault } from '../shared/plugin-settings.ts';
import type { ExtensionCtx, PiBeforeAgentStartEvent, PiExtensionAPI, PiInputEvent, PiToolParameters, SessionEntry } from '../shared/pi-types.ts';

// Sealed section: this file writes `tersio-rtk` and nothing else.
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

// Cast once, deliberately: Pi hands extensions `typebox`, but this module is loaded by jiti from a user config dir with...
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
    // Pi's footer is terminal-only; an absent mode still paints.
    if (ctx && ctx.mode !== undefined && ctx.mode !== 'tui') return;
    lastCtx = paintableCtx(lastCtx, ctx);
    const c = lastCtx;
    if (!c?.ui?.setStatus) return;
    // Combo owns the bar when any preset is active; keep ours empty to avoid duplication.
    if (isComboPresetActive() || !enabled) {
      c.ui.setStatus('rtk', undefined);
      return;
    }
    // Theme from the context that can actually paint, which is not always the incoming one.
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

  // Live mirror of shared state, so a /combo or /tersio switch lands on the next turn with no reload.
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
      // Throw: a returned object is a success on Pi, only a throw is a failure.
      if (!enabled) {
        throw new Error('RTK mode is off. Run /rtk on for this session, or use bash explicitly.');
      }
      onUpdate?.({ content: [{ type: 'text', text: `rtk ${params.args.join(' ')}` }], details: { phase: 'start' } });
      const result = await pi.exec?.('rtk', params.args, { signal, cwd: ctx?.cwd });
      if (!result) throw new Error('Pi exposes no exec() to this extension, so rtk cannot run.');
      const text = [result.stdout, result.stderr].filter(Boolean).join('\n');
      // A non-zero exit is a failed run, so rtk's own stderr reaches the model as a failure rather than as a successful...
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
    // Publish the persisted combo state first: bar suppression reads the bridge.
    reconcileSharedComboEntries(entries);
    const persisted = resolveEnabled(entries);
    enabled = typeof persisted === 'boolean' ? persisted : readRtkDefault();
    setRtkProcessEnabled(enabled);
    syncStatus(ctx);
  }

  pi.on?.('session_start', (_event, ctx) => {
    restoreEnabled(ctx);
    notify(ctx, `RTK loaded: ${enabled ? 'on' : 'off'}`);
  });

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
    // Always write, empty when off: Pi omits falsy content, so the mode switches off in one write instead of leaving a stale...
    injectPiSection(e, SECTION, enabled ? RTK_PROMPT : '');
  });
}
