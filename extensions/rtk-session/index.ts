import os from 'node:os';
import path from 'node:path';
import { activeModesSummary, asPromptArray, getSharedComboState, isComboPresetActive, isOmpSubagentPrompt, lastCustomValue, normalizeInputCommand, paintStatusBar, reconcileSharedComboEntries, sessionEntries, setSharedComboMode } from '../shared/session-state.ts';
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

const IS_WINDOWS = process.platform === 'win32';
const HOME = os.homedir();
const RTK_BINARY = path.join(HOME, '.bun', 'bin', IS_WINDOWS ? 'rtk.exe' : 'rtk');

const RTK_PROMPT = `RTK mode active for this session.
Use Rust Token Killer for shell output that would otherwise be noisy. Prefer explicit RTK commands in bash: \`rtk git status\`, \`rtk git diff\`, \`rtk read <file>\`, \`rtk grep <pattern> <path>\`, \`rtk find <glob> <path>\`, \`rtk test <cmd...>\`, \`rtk tsc\`, \`rtk lint\`, or \`rtk <tool> ...\` for supported dev commands.
Do not use RTK when exact raw output is required, when a specialized OMP tool is required by system policy, or when the command changes state and RTK would hide important confirmation text. Specialized OMP tools still win: read/glob/grep/edit/lsp stay preferred over shell equivalents.`;

interface ZodChain {
  min: (n: number) => ZodChain;
  describe: (text: string) => ZodChain;
}

export default function rtkSessionExtension(pi: ExtensionApi): void {
  const { z } = pi.zod as { z: { object: (shape: Record<string, unknown>) => Record<string, unknown>; array: (el: unknown) => ZodChain; string: () => ZodChain } };
  let enabled = DEFAULT_ENABLED;
  let isActive = false;
  let lastCtx: ExtensionCtx | undefined = undefined;

  function syncStatus(ctx?: ExtensionCtx): void {
    if (ctx) lastCtx = ctx;
    const c = ctx || lastCtx;
    if (!c?.ui?.setStatus) return;
    // Combo owns the bar when any preset is active; keep ours empty to avoid duplication.
    if (isComboPresetActive() || !enabled) {
      c.ui.setStatus('rtk', undefined);
      return;
    }
    paintStatusBar(c.ui, 'rtk', '⚡', 'rtk: ON', isActive);
  }

  function setEnabled(next: unknown, ctx?: ExtensionCtx): void {
    enabled = Boolean(next);
    pi.appendEntry?.('rtk-mode', { enabled });
    setSharedComboMode('rtk', enabled);
    syncStatus(ctx);
    const active = activeModesSummary(getSharedComboState());
    ctx?.ui?.notify?.(enabled ? `RTK on — compact shell output for this session. Active: ${active}.` : `RTK off. Active: ${active}.`, 'info');
  }

  pi.setLabel?.('RTK session toggle');

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
    parameters: z.object({
      args: z.array(z.string()).min(1).describe("Arguments passed to rtk, e.g. ['git','status'] or ['read','src/index.ts']"),
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
      const result = await pi.exec!(RTK_BINARY, params.args, { signal, cwd: ctx?.cwd || pi.cwd });
      const text = [result.stdout, result.stderr].filter(Boolean).join('\n');
      return {
        isError: result.code !== 0,
        content: [{ type: 'text', text: text || `rtk exited ${result.code}` }],
        details: { code: result.code, killed: result.killed, enabled },
      };
    },
  });

  pi.on<InputEvent>('input', async (event) => {
    if (event?.source === 'extension') return;
    const t = normalizeInputCommand(event?.text);
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
    syncStatus(ctx);
  }

  pi.on('session_start', async (_event, ctx) => {
    restoreEnabled(ctx);
    ctx?.ui?.notify?.(`RTK loaded: ${enabled ? 'on' : 'off'}`, 'info');
  });

  pi.on('session_branch', async (_event, ctx) => {
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
    const base = asPromptArray(event.systemPrompt);
    return { systemPrompt: [...base, RTK_PROMPT] };
  });
}
