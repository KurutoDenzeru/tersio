import { activeModesSummary, getSharedComboState, isComboPresetActive, isOmpSubagentPrompt, lastCustomValue, normalizeInputCommand, paintStatusBar, paintableCtx, reconcileSharedComboEntries, sessionEntries, setSharedComboListener, setSharedComboMode, statusUi } from '../shared/session-state.ts';
import { injectPromptText, onHostEvent, setExtensionLabel, stringArrayToolParams } from '../shared/host.ts';
import { readRtkDefault } from '../shared/plugin-settings.ts';
import type { ExtensionApi, ExtensionCtx, InputEvent, SessionEntry, SystemPromptEvent } from '../shared/types.ts';

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

export default function rtkSessionExtension(pi: ExtensionApi): void {
  let enabled = DEFAULT_ENABLED;
  let isActive = false;
  let lastCtx: ExtensionCtx | undefined = undefined;

  function syncStatus(ctx?: ExtensionCtx): void {
    lastCtx = paintableCtx(lastCtx, ctx);
    const ui = statusUi(lastCtx);
    if (!ui) return;
    // Combo owns the bar when any preset is active; keep ours empty to avoid duplication.
    if (isComboPresetActive() || !enabled) {
      ui.setStatus('rtk', undefined);
      return;
    }
    paintStatusBar(ui, 'rtk', '⚡', 'rtk: ON', isActive);
  }

  function setEnabled(next: unknown, ctx?: ExtensionCtx): void {
    enabled = Boolean(next);
    pi.appendEntry?.('rtk-mode', { enabled });
    setSharedComboMode('rtk', enabled);
    setRtkProcessEnabled(enabled);
    const active = activeModesSummary(getSharedComboState());
    ctx?.ui?.notify?.(enabled ? `RTK on — compact shell output for this session. Active: ${active}.` : `RTK off. Active: ${active}.`, 'info');
  }

  setExtensionLabel(pi, 'RTK session toggle');

  // Live mirror: a /tersio or /combo switch publishes shared state — adopt
  // it at once so the next turn and the rtk_run gate see it, no reload.
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
        ctx?.ui?.notify?.(`RTK: ${enabled ? 'on' : 'off'}`, 'info');
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
      ctx?.ui?.notify?.('Usage: /rtk [on|off|status]', 'warning');
    },
  });

  pi.registerTool?.({
    name: 'rtk_run',
    label: 'RTK Run',
    description: 'Run the installed `rtk` binary for compact command output when RTK mode is enabled.',
    parameters: stringArrayToolParams(pi, 'args', {
      minItems: 1,
      description: "Arguments passed to rtk, e.g. ['git','status'] or ['read','src/index.ts']",
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (!enabled) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'RTK mode is off. Run /rtk on for this session, or use bash explicitly.' }],
          details: { enabled },
        };
      }
      onUpdate?.({ content: [{ type: 'text', text: `rtk ${params.args.join(' ')}` }], details: { phase: 'start' } });
      const result = await pi.exec!('rtk', params.args, { signal, cwd: ctx?.cwd || pi.cwd });
      const text = [result.stdout, result.stderr].filter(Boolean).join('\n');
      return {
        isError: result.code !== 0,
        content: [{ type: 'text', text: text || `rtk exited ${result.code}` }],
        details: { code: result.code, killed: result.killed, enabled },
      };
    },
  });

  onHostEvent<InputEvent>(pi, 'input', async (event) => {
    if (event?.source === 'extension') return;
    const t = normalizeInputCommand(event?.text);
    if (t === 'rtk on' || t === 'use rtk') setEnabled(true);
    if (t === 'rtk off' || t === 'stop rtk') setEnabled(false);
  });
  function restoreEnabled(ctx?: ExtensionCtx): void {
    const entries = sessionEntries(ctx);
    // Derive the bridge here so bar suppression does not depend on load order.
    reconcileSharedComboEntries(entries);
    // Persisted session state wins; a fresh session falls back to the
    // installer/user-configured default (off unless configured).
    const persisted = resolveEnabled(entries);
    enabled = typeof persisted === 'boolean' ? persisted : readRtkDefault();
    setRtkProcessEnabled(enabled);
    syncStatus(ctx);
  }

  pi.on('session_start', async (_event, ctx) => {
    restoreEnabled(ctx);
    ctx?.ui?.notify?.(`RTK loaded: ${enabled ? 'on' : 'off'}`, 'info');
  });

  onHostEvent(pi, 'session_branch', async (_event, ctx) => {
    restoreEnabled(ctx);
  });

  pi.on('session_tree', async (_event, ctx) => {
    restoreEnabled(ctx);
  });

  pi.on('agent_start', async (_event, ctx) => {
    isActive = true;
    syncStatus(ctx);
  });

  pi.on('agent_end', async (_event, ctx) => {
    isActive = false;
    syncStatus(ctx);
  });

  pi.on<SystemPromptEvent>('before_agent_start', async (event) => {
    const active = isOmpSubagentPrompt(event.systemPrompt) ? getSharedComboState().rtk === 'on' : enabled;
    if (!active) return;
    return injectPromptText(pi, event, RTK_PROMPT);
  });
}
