// /headroom session mode: tracks the user's Headroom (headroomlabs-ai) install. Opt-in, so no preset turns it on.

import { getSharedComboState, hasModeState, isOmpSubagentPrompt, lastCustomValue, normalizeInputCommand, normalizeMode, reconcileSharedComboEntries, sessionEntries, setSharedComboListener, setSharedComboMode, systemPromptIncludes } from '../shared/session-state.ts';
import { hostIdOf, injectPromptText, onHostEvent, sessionChangeEvents, setExtensionLabel } from '../shared/host.ts';
import { announceStatus } from '../shared/status.ts';
import { readHeadroomDefault } from '../shared/plugin-settings.ts';
import { resolveHeadroomBinary } from '../shared/utils.ts';
import { headroomHostSupported, headroomProxyUrl } from '../shared/headroom-proxy.ts';
import { describeHeadroomRoute, readHeadroomRoute } from '../shared/headroom-routing.ts';
import { ensureTersioMcp } from '../shared/mcp-config.ts';
import type { HeadroomRoute } from '../shared/headroom-routing.ts';
import type { ExtensionApi, ExtensionCtx, InputEvent, SessionEntry, SystemPromptEvent } from '../shared/types.ts';

const DEFAULT_MODE = 'off';
export const HEADROOM_INSTALL_HINT = 'pip install "headroom-ai[all]"';

// A successful probe holds for longer than a miss, so a turn never pays the timeout twice in a row.
const probeCache: { url: string; at: number; up: boolean } = { url: '', at: 0, up: false };

/** True when headroom's proxy answers: with none, no traffic compresses and the block would lie. */
export async function headroomProxyUp(url: string = headroomProxyUrl(), budgetMs = 400): Promise<boolean> {
  const now = Date.now();
  if (probeCache.url === url && now - probeCache.at < (probeCache.up ? 30_000 : 10_000)) return probeCache.up;
  let up = false;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(budgetMs) });
    await res.body?.cancel();
    up = true;
  } catch { /* refused or too slow: the runtime is down */ }
  probeCache.url = url;
  probeCache.at = now;
  probeCache.up = up;
  return up;
}

// The proxy compresses traffic below the shell layer, so the block only tells the model what changes and how to recover detail.
export function headroomInstruction(route?: HeadroomRoute): string {
  const scope = route?.routed ? `Compression applies to ${route.model} via ${route.provider ?? 'its provider'}.` : 'Headroom compression is enabled for this session.';
  return `🍃 HEADROOM MODE ACTIVE — level: on\n${scope} Tool outputs, file reads, and history may be compressed before reaching you. A compressed result can elide details; treat its elision markers as real. Recover the original by hash with the tersio_headroom MCP tool ({action:"retrieve", hash:"<HASH>"}). If that tool is not available, re-run the source command or re-read the file.`;
}

function resolveMode(entries: SessionEntry[] | null | undefined, fallback: string = DEFAULT_MODE): string {
  return lastCustomValue(entries, 'headroom-mode', (data) => normalizeMode('headroom', data?.mode)) ?? fallback;
}

// The shared off phrase; every mode honours it, so one word clears the session.
function isOffCommand(text: unknown): boolean {
  return normalizeInputCommand(text) === 'normal mode';
}

export default function headroomSessionExtension(pi: ExtensionApi): void {
  const host = hostIdOf(pi);
  // pi and PiG have no headroom route, so their block would promise compression their traffic never gets.
  const supported = headroomHostSupported(host);
  let currentMode = DEFAULT_MODE;
  let lastInjected: string | undefined = undefined;
  let unroutedNotified = false;

  function setMode(mode: string, ctx?: ExtensionCtx): boolean {
    if (!supported) return false;
    const normalized = normalizeMode('headroom', mode);
    if (!normalized) return false;
    currentMode = normalized;
    unroutedNotified = false;
    pi.appendEntry?.('headroom-mode', { mode: normalized });
    setSharedComboMode('headroom', normalized);
    // Turning the mode on is the moment the agent needs the retrieve tool; wiring is idempotent.
    if (normalized === 'on') ensureTersioMcp(host);
    announceStatus(ctx);
    return true;
  }

  setExtensionLabel(pi, 'Headroom session toggle');

  // Adopt a /tersio or /combo switch at once, so the next turn needs no reload.
  function syncFromShared(state: { headroom: string }): void {
    const mode = normalizeMode('headroom', state.headroom);
    if (mode) currentMode = mode;
  }
  setSharedComboListener('headroom', syncFromShared);

  pi.registerCommand?.('headroom', {
    description: 'Toggle the Headroom token-saver mode for this session',
    handler: async (args, ctx) => {
      const arg = String(args || '').trim().toLowerCase();
      if (!supported && arg !== 'status') {
        ctx?.ui?.notify?.('Headroom does not support this agent. Its durable integration covers Oh My Pi and OpenCode.', 'warning');
        return;
      }
      if (!arg || arg === 'on') {
        setMode('on', ctx);
        // The mode can be on while the tool is absent; never silent about it, never installing on our own.
        if (!resolveHeadroomBinary()) {
          ctx?.ui?.notify?.(`Headroom binary not found on PATH. Install it yourself with: ${HEADROOM_INSTALL_HINT}`, 'warning');
        }
        return;
      }
      if (arg === 'status') {
        announceStatus(ctx);
        return;
      }
      if (!setMode(arg, ctx)) {
        ctx?.ui?.notify?.('Usage: /headroom [on|off|status]', 'warning');
      }
    },
  });

  onHostEvent<InputEvent>(pi, 'input', async (event) => {
    if (event?.source === 'extension') return;
    if (currentMode !== 'off' && isOffCommand(event?.text)) setMode('off');
  });

  function restoreMode(ctx?: ExtensionCtx): void {
    unroutedNotified = false;
    const entries = sessionEntries(ctx);
    // A subagent's branch has no Tersio entries; reconciling it would wipe shared state.
    if (hasModeState(entries)) reconcileSharedComboEntries(entries);
    // Persisted state wins, then a mode already chosen, then the configured default. `off` is the start value, not unset.
    if (!supported) {
      currentMode = DEFAULT_MODE;
      announceStatus(ctx);
      return;
    }
    const persisted = resolveMode(entries, '');
    const alreadyChosen = currentMode !== DEFAULT_MODE;
    currentMode = persisted || (alreadyChosen ? currentMode : normalizeMode('headroom', readHeadroomDefault(host))) || DEFAULT_MODE;
    announceStatus(ctx);
  }

  // Start, resume, and branch all land here, so every session type shows it.
  pi.on('session_start', async (_event, ctx) => {
    restoreMode(ctx);
  });

  // The host adapter names the switch events it emits, so this stays free of any one host's naming.
  for (const event of sessionChangeEvents(pi)) {
    onHostEvent(pi, event, async (_event, ctx) => {
      restoreMode(ctx);
    });
  }

  pi.on<SystemPromptEvent>('before_agent_start', async (event: SystemPromptEvent, ctx?: ExtensionCtx) => {
    const mode = isOmpSubagentPrompt(event.systemPrompt) ? getSharedComboState().headroom : currentMode;
    if (!mode || mode === 'off') return;
    // Nothing is compressed when the tool is absent, so the block would lie to the model.
    if (!resolveHeadroomBinary()) return;
    // The same rule applies to a binary with no runtime behind it: headroom's proxy is what compresses.
    if (!(await headroomProxyUp())) return;
    // A live proxy is not enough: the configured model must actually point at it.
    const route = readHeadroomRoute(host);
    if (!route.measured || !route.routed) {
      if (!unroutedNotified) {
        unroutedNotified = true;
        ctx?.ui?.notify?.(`Headroom is on, but this agent does not route through it. ${describeHeadroomRoute(route)}.`, 'warning');
      }
      return;
    }
    const instruction = headroomInstruction(route);
    // Match the whole instruction, so a re-presented prompt cannot stack it.
    if (systemPromptIncludes(event.systemPrompt, instruction)) return;
    // The previous block is replaced, not stacked on.
    const stale = lastInjected;
    lastInjected = instruction;
    return injectPromptText(pi, event, { text: instruction, staleMarker: stale, sectionTag: 'headroom' });
  });
}