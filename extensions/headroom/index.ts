// /headroom session mode: tracks the user's Headroom (headroomlabs-ai) install. Opt-in, so no preset turns it on.

import {
  getSharedComboState,
  hasModeState,
  isOmpSubagentPrompt,
  lastCustomValue,
  normalizeInputCommand,
  normalizeMode,
  reconcileSharedComboEntries,
  sessionEntries,
  setSharedComboListener,
  setSharedComboMode,
  systemPromptIncludes,
} from '../shared/session-state.ts';
import { hostIdOf, injectPromptText, onHostEvent, sessionChangeEvents, setExtensionLabel } from '../shared/host.ts';
import { announceStatus } from '../shared/status.ts';
import type { HostScope } from '../shared/plugin-settings.ts';
import { readHeadroomDefault, saveModeState } from '../shared/plugin-settings.ts';
import { resolveHeadroomBinary } from '../shared/utils.ts';
import {
  headroomHostSupported,
  headroomProxyPort,
  headroomProxyUrl,
  isHeadroomCompatibleApi,
  ompProviderUpstream,
  routeOmpModel,
} from '../shared/headroom-proxy.ts';
import type { HeadroomRoute } from '../shared/headroom-routing.ts';
import { describeHeadroomRoute, readHeadroomRoute, sameProxyEndpoint } from '../shared/headroom-routing.ts';
import {
  headroomRestartConflict,
  headroomRoutedHosts,
  headroomRouteUpstreams,
  repairHeadroomRoute,
} from '../shared/headroom-routes.ts';
import {
  ensureHeadroomRuntime,
  liveHeadroomUpstreams,
  releaseHeadroomLease,
  touchHeadroomLease,
} from '../shared/headroom-runtime.ts';
import { ensureTersioMcp } from '../shared/mcp-config.ts';
import type {
  AgentModel,
  ExtensionApi,
  ExtensionCtx,
  InputEvent,
  SessionEntry,
  SystemPromptEvent,
} from '../shared/types.ts';

const DEFAULT_MODE = 'off';

/** True when this session needs the proxy: the mode compresses traffic, or a route points at it. */
export function needsHeadroomProxy(mode: string, routed: boolean): boolean {
  return mode === 'on' || routed;
}
export const HEADROOM_INSTALL_HINT = 'pip install "headroom-ai[all]"';

// A successful probe holds for longer than a miss, so a turn never pays the timeout twice in a row.
const probeCache: { url: string; at: number; up: boolean } = { url: '', at: 0, up: false };

/**
 * True when anything on this machine expects the proxy: this host's route, any other agent's route,
 * or a headroom default saved for any scope. One proxy serves them all, so any of them counts.
 */
export function headroomWanted(host: string): boolean {
  if (readHeadroomRoute(host).routed || headroomRoutedHosts().length > 0) return true;
  // The shared default plus every scope the settings store names; dsh inherits the shared one.
  const scopes: Array<HostScope | null> = [null, 'omp', 'pi', 'pig', 'opencode'];
  return scopes.some((id) => normalizeMode('headroom', readHeadroomDefault(id)) === 'on');
}

/** True when headroom's proxy answers: with none, no traffic compresses and the block would lie. */
export async function headroomProxyUp(url: string = headroomProxyUrl(), budgetMs = 400): Promise<boolean> {
  const now = Date.now();
  if (probeCache.url === url && now - probeCache.at < (probeCache.up ? 30_000 : 10_000)) return probeCache.up;
  let up = false;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(budgetMs) });
    await res.body?.cancel();
    up = true;
  } catch {
    /* refused or too slow: the runtime is down */
  }
  probeCache.url = url;
  probeCache.at = now;
  probeCache.up = up;
  return up;
}

// The proxy compresses traffic below the shell layer, so the block only tells the model what changes and how to recover detail.
export function headroomInstruction(route?: HeadroomRoute): string {
  const scope = route?.routed
    ? `Compression applies to ${route.model} via ${route.provider ?? 'its provider'}.`
    : 'Headroom compression is enabled for this session.';
  return `🍃 HEADROOM MODE ACTIVE — level: on\n${scope} Tool outputs, file reads, and history may be compressed before reaching you. A compressed result can elide details; treat its elision markers as real. Recover the original by hash with the tersio_headroom MCP tool ({action:"retrieve", hash:"<HASH>"}). If that tool is not available, re-run the source command or re-read the file.`;
}

function resolveMode(entries: SessionEntry[] | null | undefined, fallback: string = DEFAULT_MODE): string {
  return lastCustomValue(entries, 'headroom-mode', (data) => normalizeMode('headroom', data?.mode)) ?? fallback;
}

// The shared off phrase; every mode honours it, so one word clears the session.
function isOffCommand(text: unknown): boolean {
  return normalizeInputCommand(text) === 'normal mode';
}

function hasUpstreamHeader(model: AgentModel): boolean {
  return Object.entries(model.headers ?? {}).some(
    ([name, value]) => name.toLowerCase() === 'x-headroom-base-url' && typeof value === 'string' && value.trim() !== '',
  );
}

export default function headroomSessionExtension(pi: ExtensionApi): void {
  const host = hostIdOf(pi);
  // A host without a known model route would get a promise its traffic never fulfils.
  const supported = headroomHostSupported(host);
  let currentMode = DEFAULT_MODE;
  let lastInjected: string | undefined = undefined;
  let unroutedNotified = false;
  let lastRepairedModel = '';
  function setMode(mode: string, ctx?: ExtensionCtx): boolean {
    if (!supported) return false;
    const normalized = normalizeMode('headroom', mode);
    if (!normalized) return false;
    currentMode = normalized;
    unroutedNotified = false;
    pi.appendEntry?.('headroom-mode', { mode: normalized });
    setSharedComboMode('headroom', normalized);
    saveModeState(host, getSharedComboState());
    // Turning the mode on is the moment the agent needs the retrieve tool; wiring is idempotent.
    if (normalized === 'on') ensureTersioMcp(host);
    announceStatus(ctx);
    return true;
  }

  // One agent process holds one lease. A session that dies without a shutdown stops refreshing it,
  // so the proxy is not held forever by a process that is gone.
  const sessionId = String(process.pid);
  let routeWarning = '';
  const originals = new Map<string, AgentModel>();

  function routeModel(model: AgentModel): AgentModel {
    if (!isHeadroomCompatibleApi(model.api)) return model;
    const key = `${model.provider}/${model.id}`;
    let original = originals.get(key);
    if (!original || !sameProxyEndpoint(model.baseUrl, headroomProxyUrl())) {
      const upstream = sameProxyEndpoint(model.baseUrl, headroomProxyUrl())
        ? ompProviderUpstream(model.provider, headroomProxyPort(), key)?.url
        : model.baseUrl;
      if (!upstream || sameProxyEndpoint(upstream, headroomProxyUrl())) {
        throw new Error(`Headroom: original upstream unavailable for ${key}; refusing an ambiguous proxy request.`);
      }
      original = { ...model, baseUrl: upstream };
      originals.set(key, original);
    }
    const source = original;
    const rootUpstream = source.baseUrl.replace(/\/+$/, '');
    const upstream = model.api.startsWith('openai') ? rootUpstream.replace(/\/v1$/, '') : rootUpstream;
    const codex = model.api === 'openai-codex-responses';
    const headers = { ...source.headers };
    for (const name of Object.keys(headers)) {
      if (name.toLowerCase() === 'x-headroom-base-url') delete headers[name];
    }
    if (!codex) headers['x-headroom-base-url'] = upstream;
    const root = headroomProxyUrl().replace(/\/+$/, '');
    return {
      ...model,
      baseUrl: `${root}${/anthropic|google-gemini-cli/.test(model.api) ? '' : '/v1'}`,
      headers,
      resolveHeaders: async (signal) => {
        const resolved = { ...headers, ...(await source.resolveHeaders?.(signal)) };
        for (const name of Object.keys(resolved)) {
          if (name.toLowerCase() === 'x-headroom-base-url') delete resolved[name];
        }
        if (!codex) resolved['x-headroom-base-url'] = upstream;
        return resolved;
      },
    };
  }

  function warnRoute(message: string, ctx: ExtensionCtx): void {
    if (routeWarning !== message) ctx.ui?.notify?.(message, 'warning');
    routeWarning = message;
  }
  // OMP 18.22.0 checks the active provider signal after its onPayload hook.
  function stopHeadroomRequest(ctx: ExtensionCtx | undefined, reason: string, notify = true): void {
    if (host === 'omp' && ctx && 'abort' in ctx && typeof ctx.abort === 'function') {
      if (notify) ctx.ui?.notify?.(`Headroom: ${reason}; request aborted.`, 'warning');
      ctx.abort();
      return;
    }
    if (notify) {
      ctx?.ui?.notify?.(
        `Headroom: ${reason}; this host has no verified active-operation abort API, so the request may continue.`,
        'warning',
      );
    }
  }

  /** OMP exposes its live selection; config.yml remains the startup default, not /model's state. */
  async function prepareSessionRoute(ctx: ExtensionCtx): Promise<HeadroomRoute | undefined> {
    const model = ctx.models?.current() ?? ctx.model;
    if (host !== 'omp' || !model) return undefined;
    const proxyUrl = headroomProxyUrl();
    const route: HeadroomRoute = {
      measured: true,
      failure: '',
      host,
      proxyUrl,
      model: `${model.provider}/${model.id}`,
      provider: model.provider,
      baseUrl: model.baseUrl,
      routed: sameProxyEndpoint(model.baseUrl, proxyUrl),
    };
    const bin = resolveHeadroomBinary();
    if (!bin) return { ...route, routed: false };
    if (!isHeadroomCompatibleApi(model.api)) {
      warnRoute(`Headroom: ${model.provider} uses ${model.api}; leaving its endpoint unchanged.`, ctx);
      return { ...route, routed: false };
    }
    touchHeadroomLease(sessionId);
    const ready = await ensureHeadroomRuntime(bin);
    if (!ready.ok) {
      throw new Error(`Headroom: ${ready.detail}; proxy request could not be prepared.`);
    }
    const routed = routeModel(model);
    const baseUrl = routed.baseUrl;
    if (!pi.setModel) {
      throw new Error('Headroom: this host cannot apply a safe request-local model route.');
    }
    // Only the selected provider is written, not every role and fallback in config.yml.
    if (!routeOmpModel(`${model.provider}/${model.id}`, headroomProxyPort())) {
      throw new Error(
        `Headroom: could not persist a recoverable route for ${model.provider}. Proxy routing is not ready.`,
      );
    }
    const thinking = pi.getThinkingLevel?.();
    if (!(await pi.setModel(routed))) {
      throw new Error(
        `Headroom: could not update the live ${model.provider} model endpoint. Proxy routing is not ready.`,
      );
    }
    if (thinking !== undefined) await pi.setThinkingLevel?.(thinking);
    routeWarning = '';
    touchHeadroomLease(sessionId);
    return { ...route, baseUrl, routed: true };
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
      const arg = String(args || '')
        .trim()
        .toLowerCase();
      if (!supported && arg !== 'status') {
        ctx?.ui?.notify?.('Headroom has no route for this agent.', 'warning');
        return;
      }
      if (!arg || arg === 'on') {
        setMode('on', ctx);
        // The mode can be on while the tool is absent; never silent about it, never installing on our own.
        if (!resolveHeadroomBinary()) {
          ctx?.ui?.notify?.(
            `Headroom binary not found on PATH. Install it yourself with: ${HEADROOM_INSTALL_HINT}`,
            'warning',
          );
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
    lastRepairedModel = '';
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
    currentMode =
      persisted || (alreadyChosen ? currentMode : normalizeMode('headroom', readHeadroomDefault(host))) || DEFAULT_MODE;
    announceStatus(ctx);
  }

  let runtimeStarting: Promise<void> | undefined;
  // A route outlives a reboot; the proxy does not, and a route to a dead port fails the first request.
  // Fire-and-forget: the session starts now, and headroom answers within its own wait window.
  function startRuntime(ctx?: ExtensionCtx): void {
    // One proxy serves the machine, so any reason it is wanted counts: this host's mode, this host's
    // route, another agent's route, or a headroom default saved for some host.
    if (!needsHeadroomProxy(currentMode, headroomWanted(host))) return;
    const bin = resolveHeadroomBinary();
    if (!bin) return;

    const route = readHeadroomRoute(host);
    // OMP may repair an unrouted provider during before_agent_start; start with its upstreams first,
    // or the repair guard sees Headroom's public defaults and correctly refuses to route it.
    const routedHosts = headroomRoutedHosts();
    const upstreamHost = host === 'omp' && route.measured ? host : routedHosts.includes('omp') ? 'omp' : routedHosts[0];
    const upstreams = upstreamHost ? headroomRouteUpstreams(upstreamHost) : {};
    if (Object.keys(upstreams).length > 0) {
      const conflict = headroomRestartConflict(upstreamHost ?? host, upstreams, liveHeadroomUpstreams());
      if (conflict) {
        ctx?.ui?.notify?.(conflict, 'warning');
        return;
      }
    }

    // The claim is written first, so a stop from another session sees this one and leaves the proxy up.
    touchHeadroomLease(sessionId);
    // Preserve routed providers' per-dialect upstreams across proxy restarts and machine reboots.
    runtimeStarting = ensureHeadroomRuntime(bin, upstreams).then(
      () => undefined,
      () => undefined /* the next session retries */,
    );
  }

  // Start, resume, and branch all land here, so every session type shows it.
  pi.on('session_start', async (_event, ctx) => {
    restoreMode(ctx);
    const model = ctx?.models?.current() ?? ctx?.model;
    // Only OMP routes per model; every other host just needs the proxy up. A model saved with the proxy
    // endpoint needs its upstream header even when the mode is off, or its requests reach the proxy's global upstream.
    const proxied = host === 'omp' && model !== undefined && sameProxyEndpoint(model.baseUrl, headroomProxyUrl());
    if (host === 'omp' && ctx && model && currentMode !== 'off') await prepareSessionRoute(ctx);
    else if (proxied && ctx) {
      try {
        await prepareSessionRoute(ctx);
      } catch (error) {
        warnRoute(error instanceof Error ? error.message : String(error), ctx);
        startRuntime(ctx);
      }
    } else startRuntime(ctx);
  });

  // The host adapter names the switch events it emits, so this stays free of any one host's naming.
  for (const event of sessionChangeEvents(pi)) {
    onHostEvent(pi, event, async (_event, ctx) => {
      restoreMode(ctx);
    });
  }

  pi.on('retry_fallback_applied', async (_event, ctx) => {
    const model = ctx.models?.current() ?? ctx.model;
    if (currentMode === 'on' || (model && sameProxyEndpoint(model.baseUrl, headroomProxyUrl()))) {
      await prepareSessionRoute(ctx);
    }
  });

  pi.on('before_provider_request', async (_event, ctx) => {
    const model = ctx.model ?? ctx.models?.current();
    const routed = model ? sameProxyEndpoint(model.baseUrl, headroomProxyUrl()) : false;
    if (currentMode === 'on' && !routed) {
      stopHeadroomRequest(ctx, 'active model is not routed through the Headroom proxy');
      return;
    }
    if (!routed) return;
    try {
      // A saved proxy endpoint from an earlier session carries no upstream header; add it before the request leaves.
      if (host === 'omp' && currentMode !== 'on' && model && !hasUpstreamHeader(model)) await prepareSessionRoute(ctx);
      touchHeadroomLease(sessionId);
      const bin = resolveHeadroomBinary();
      if (!bin) {
        stopHeadroomRequest(ctx, 'Headroom executable is unavailable');
        return;
      }
      const ready = await ensureHeadroomRuntime(bin);
      if (!ready.ok) stopHeadroomRequest(ctx, ready.detail);
    } catch {
      stopHeadroomRequest(ctx, 'proxy readiness could not be verified');
    }
  });

  // Model endpoints remain routed across agent exits, so quitting releases only this session's claim.
  // A reload keeps the same claim because the process relaunches and uses it again.
  pi.on('session_shutdown', async (event) => {
    const reason = (event as { reason?: unknown } | undefined)?.reason;
    if (reason === 'reload' || reason === 'new' || reason === 'resume' || reason === 'fork') return;
    await releaseHeadroomLease(sessionId).catch(() => {
      /* a lease that cannot be removed must not interrupt agent shutdown */
    });
  });

  pi.on<SystemPromptEvent>('before_agent_start', async (event: SystemPromptEvent, ctx?: ExtensionCtx) => {
    const mode = isOmpSubagentPrompt(event.systemPrompt) ? getSharedComboState().headroom : currentMode;
    currentMode = mode || DEFAULT_MODE;
    if (!mode || mode === 'off') return;
    // Nothing is compressed when the tool is absent, so the block would lie to the model.
    if (!resolveHeadroomBinary()) return;
    // The proxy this session's start began must be settled before the route is judged, or a slow start reads as a dead proxy.
    await runtimeStarting;
    const sessionRoute = ctx ? await prepareSessionRoute(ctx) : undefined;
    // A live proxy is not enough: the selected model must actually point at it.
    if (!(await headroomProxyUp())) return;
    let route = sessionRoute ?? readHeadroomRoute(host);
    // When the active model is not routed yet, route it automatically on the fly.
    const repairKey = `${route.provider ?? ''}:${route.model ?? ''}`;
    if (!sessionRoute && !route.routed && repairKey !== lastRepairedModel) {
      lastRepairedModel = repairKey;
      const repaired = await repairHeadroomRoute(host);
      if (repaired.ok) {
        route = readHeadroomRoute(host);
        ctx?.ui?.notify?.(
          `Headroom: another tool reset this agent's route. ${repaired.detail}. Reopen /model so this session uses it.`,
          'info',
        );
      }
    }
    if (!route.measured || !route.routed) {
      if (!unroutedNotified) {
        unroutedNotified = true;
        ctx?.ui?.notify?.(
          `Headroom is on, but this agent does not route through it. ${describeHeadroomRoute(route)}. Route it with: tersio install --host ${host} --headroom-default on.`,
          'warning',
        );
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
