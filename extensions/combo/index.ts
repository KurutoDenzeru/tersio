// /combo session toggle: off | lite | balanced | max.

import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  activeModesSummary,
  COMBO_LEVELS,
  getSharedComboState,
  hasModeState,
  normalizeComboLevel,
  normalizeMode,
  reconcileSharedComboEntries,
  sessionEntries,
  setSharedComboLevel,
  setSharedComboListener,
  setSharedComboMode,
  setSharedComboModes,
  systemPromptIncludes,
} from '../shared/session-state.ts';
import { hostIdOf, hostSelect, injectPromptText, isOpencodeHost, onHostEvent, sessionChangeEvents, setExtensionLabel } from '../shared/host.ts';
import type { HostScope } from '../shared/plugin-settings.ts';
import { announceStatus } from '../shared/status.ts';
import {
  isComboSetupComplete,
  readCavemanDefault,
  readComboDefault,
  readHeadroomDefault,
  readPluginSettings,
  readPonytailDefault,
  readPstackDefault,
  readRtkDefault,
  saveComboSetup,
} from '../shared/plugin-settings.ts';
import { isPiLikeProcess, pigAgentDir, piAgentDir } from '../shared/utils.ts';
import type { ComboState, ExtensionApi, ExtensionCtx, SystemPromptEvent } from '../shared/types.ts';

const EXTENSION_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Whether pi or pig declares an upstream Ponytail; read per call so a mid-session settings.json change lands. */
function piHasUpstreamPonytail(): boolean {
  for (const agentDir of [piAgentDir(), pigAgentDir()]) {
    // The fork ships index.ts; an older install's package still holds index.js, so both count as present.
    if (['index.ts', 'index.js'].some((base) => existsSync(path.join(agentDir, 'ponytail', 'pi-extension', base)))) return true;
    try {
      const raw = readFileSync(path.join(agentDir, 'settings.json'), 'utf8');
      const settings = JSON.parse(raw) as { packages?: unknown };
      const list = Array.isArray(settings.packages) ? settings.packages : [];
      // An npm spec names the package; the installer's local copy is a bare `.../ponytail` dir.
      if (list.some((p) => typeof p === 'string' && /ponytail/.test(p))) return true;
    } catch { /* continue checking next agent dir */ }
  }
  return false;
}

// Each level's own rule, quoted from the installed Ponytail so a host that cannot resolve the package still gets the right register: `lite` builds what was asked and offers the smaller option, and only `ultra` questions the request.
const PONYTAIL_FALLBACK_INTENSITY: Record<string, string> = {
  lite: 'Build what was asked. Name the smaller option in one line and let the user pick.',
  full: 'The rules above. Default.',
  ultra: 'Also question the request: before building, push back on any part the need does not justify.',
};

// Fallback text when Ponytail cannot be found; exported for its own test.
export function ponytailFallback(mode: string): string {
  const intensity = PONYTAIL_FALLBACK_INTENSITY[mode] ?? 'Use the minimum correct solution. Delete or reuse before adding.';
  return `🧠 PONYTAIL MODE ACTIVE — level: ${mode}\n${intensity} Understand the path first and fix root causes, not symptoms. Prefer the standard library and YAGNI. Avoid speculative abstractions and dependencies. Preserve correctness. Verify changed behavior.`;
}


// Ponytail is hoisted, so one upward walk covers every layout. jiti and Bun both load TypeScript, so the module's named exports arrive directly.
async function loadPonytailInstructions(mode: string): Promise<string> {
  // Ponytail rides inside this tree; the OpenCode layout bundles the ruleset beside the extensions.
  const vendored = path.join(EXTENSION_DIR, '..', 'ponytail', 'hooks', 'ponytail-instructions.ts');
  const bundled = path.join(EXTENSION_DIR, '..', 'ponytail-bundle', 'hooks', 'ponytail-instructions.ts');
  const treeLocal = existsSync(vendored) ? vendored : (existsSync(bundled) ? bundled : null);
  if (treeLocal) {
    try {
      const loaded = await import(pathToFileURL(treeLocal).href) as {
        getPonytailInstructions?: (level: string) => string;
        default?: { getPonytailInstructions?: (level: string) => string };
      };
      const build = loaded.getPonytailInstructions ?? loaded.default?.getPonytailInstructions;
      if (build) return build(mode);
    } catch { /* fall through to the built-in text */ }
  }
  return ponytailFallback(mode);
}

// What a fresh session starts from: a stored per-mode default wins, and with none the Combo preset supplies the three it owns. pstackDefault and headroomDefault count as their own defaults, so a session that stores only one still honors it instead of losing it to the preset. A host's own section wins over the shared keys, and a host that stores only a preset gets that preset's three modes rather than a mix of its preset and the shared levels.
function savedModes(host: HostScope): { caveman: string; rtk: string; ponytail: string; pstack: string; headroom: string } {
  const settings = readPluginSettings();
  const own = (settings.hosts as Record<string, Record<string, unknown>> | undefined)?.[host] ?? {};
  const hasOwnModes = ['cavemanDefault', 'rtkDefault', 'ponytailDefault', 'pstackDefault', 'headroomDefault'].some((key) => key in own);
  if (!hasOwnModes && 'comboDefault' in own) {
    const preset = COMBO_LEVELS[readComboDefault(host)] ?? COMBO_LEVELS.off;
    return { ...preset, pstack: readPstackDefault(host), headroom: readHeadroomDefault(host) };
  }
  const hasModeDefaults = ['cavemanDefault', 'rtkDefault', 'ponytailDefault', 'pstackDefault', 'headroomDefault'].some((key) => key in settings);
  const preset = COMBO_LEVELS[readComboDefault(host)];
  return hasModeDefaults
    ? { caveman: readCavemanDefault(host), rtk: readRtkDefault(host) ? 'on' : 'off', ponytail: readPonytailDefault(host), pstack: readPstackDefault(host), headroom: readHeadroomDefault(host) }
    : { ...preset, pstack: 'off', headroom: 'off' };
}

// Registers the shared-state listener for this session's UI; the factory calls it per context.
function listen(ctx?: ExtensionCtx): void {
  if (!ctx?.hasUI) return;
  setSharedComboListener('combo', (state) => { announceStatus(ctx); return state; });
}

export default function comboToggleExtension(pi: ExtensionApi): void {
  const host = hostIdOf(pi);
  setExtensionLabel(pi, 'Combo session toggle (caveman, RTK, Ponytail)');

  let setupPrompted = false;
  let lastInjected: string | undefined = undefined;
  // opencode has no UI event stream, so only its empty branch reconciles.
  const OPENCODE = isOpencodeHost(pi);

  // Siblings restore from these entries, so the fallback must write them too. A preset owns three modes, so it writes no pstack entry.
  function persistPreset(level: string): void {
    const modes = COMBO_LEVELS[level];
    pi.appendEntry?.('caveman-mode', { mode: modes.caveman });
    pi.appendEntry?.('rtk-mode', { enabled: modes.rtk === 'on' });
    pi.appendEntry?.('ponytail-mode', { mode: modes.ponytail });
    pi.appendEntry?.('combo-level', { level });
  }
  function restoreConfiguredDefaults(): void {
    const combo = readComboDefault(host);
    const preset = COMBO_LEVELS[combo];
    const modes = savedModes(host);
    setSharedComboModes(modes);
    if (modes.caveman === 'off' && modes.rtk === 'off' && modes.ponytail === 'off' && modes.pstack === 'off' && modes.headroom === 'off') return;
    pi.appendEntry?.('caveman-mode', { mode: modes.caveman });
    pi.appendEntry?.('rtk-mode', { enabled: modes.rtk === 'on' });
    pi.appendEntry?.('ponytail-mode', { mode: modes.ponytail });
    if (modes.pstack !== 'off') pi.appendEntry?.('pstack-mode', { mode: modes.pstack });
    if (modes.headroom !== 'off') pi.appendEntry?.('headroom-mode', { mode: modes.headroom });
    if (preset && modes.caveman === preset.caveman && modes.rtk === preset.rtk && modes.ponytail === preset.ponytail) {
      pi.appendEntry?.('combo-level', { level: combo });
    }
  }


  function reconcile(ctx?: ExtensionCtx, resetEmpty = false): Readonly<ComboState> {
    if (!ctx?.hasUI && !(resetEmpty && OPENCODE)) return getSharedComboState();
    const entries = sessionEntries(ctx);
    if (!resetEmpty && entries.length === 0) return getSharedComboState();
    return reconcileSharedComboEntries(entries);
  }
  function track(ctx?: ExtensionCtx, resetEmpty = false): void {
    listen(ctx);
    if (ctx?.hasUI || (resetEmpty && OPENCODE)) reconcile(ctx, resetEmpty);
  }

  pi.registerCommand?.('combo', {
    description: 'Toggle caveman, RTK and Ponytail at once. Usage: /combo <off|lite|balanced|max|status>',
    handler: async (args, ctx) => {
      listen(ctx);
      const arg = String(args || '').trim().toLowerCase();

      if (!arg || arg === 'status') {
        reconcile(ctx);
        announceStatus(ctx);
        return;
      }

      if (arg === 'help') {
        ctx?.ui?.notify?.(
          '/combo off      — disables caveman, rtk and ponytail. pstack keeps its own setting\n' +
          '/combo lite     — light: caveman=lite, rtk=on, ponytail=lite\n' +
          '/combo balanced — middle: caveman=full, rtk=on, ponytail=full\n' +
          '/combo max      — aggressive: caveman=ultra, rtk=on, ponytail=ultra\n' +
          'pstack is not part of a preset. Set it on its own with /pstack on|off\n' +
          'headroom is not part of a preset either. Set it on its own with /headroom on|off',
          'info'
        );
        return;
      }

      const level = normalizeComboLevel(arg);
      if (!level) {
        ctx?.ui?.notify?.(
          `Unknown combo level: ${arg}. Use: off | lite | balanced | max`,
          'warning'
        );
        return;
      }

      persistPreset(level);
      setSharedComboLevel(level);
      announceStatus(ctx);
    },
  });

  // Upstream owns /ponytail on pi; this tree registers it only where nothing else does.
  if (!(isPiLikeProcess() && piHasUpstreamPonytail())) pi.registerCommand?.('ponytail', {
    description: 'Switch Ponytail intensity (off|lite|full|ultra). Usage: /ponytail [level|status]',
    handler: async (args, ctx) => {
      listen(ctx);
      const arg = String(args || '').trim().toLowerCase();
      if (!arg || arg === 'status') {
        announceStatus(ctx);
        return;
      }
      const mode = normalizeMode('ponytail', arg);
      if (!mode) {
        ctx?.ui?.notify?.(`Unknown Ponytail level: ${arg}. Use: off | lite | full | ultra`, 'warning');
        return;
      }
      pi.appendEntry?.('ponytail-mode', { mode });
      setSharedComboMode('ponytail', mode);
      announceStatus(ctx);
    },
  });

  async function runFirstRunSetup(ctx?: ExtensionCtx): Promise<void> {
    if (setupPrompted || !ctx?.hasUI || !ctx.ui?.select || isComboSetupComplete()) return;
    setupPrompted = true;
    const choice = await hostSelect(pi, ctx.ui, 'Session-start defaults — Combo preset', [
      { label: 'off', description: 'Keep caveman, RTK and Ponytail inactive' },
      { label: 'lite', description: 'caveman=lite, rtk=on, ponytail=lite' },
      { label: 'balanced', description: 'caveman=full, rtk=on, ponytail=full' },
      { label: 'max', description: 'caveman=ultra, rtk=on, ponytail=ultra' },
    ], { selectionMarker: 'radio', helpText: 'You can change this later with /tersio settings. pstack is separate.' });
    const level = choice || 'off';
    // The first-run prompt stays machine-wide: it runs before any per-host choice exists, and a host-scoped write here would strand the other agents on off.
    if (saveComboSetup(level) && level !== 'off') {
      persistPreset(level);
      setSharedComboLevel(level);
      ctx.ui.notify?.(`Combo default saved: ${level} — ${activeModesSummary(getSharedComboState())} will activate on fresh sessions.`, 'info');
    }
  }

  pi.on('session_start', async (_event, ctx) => {
    track(ctx, true);
    if (!isComboSetupComplete() && ctx?.hasUI && ctx.ui?.select) await runFirstRunSetup(ctx);
    // The configured defaults apply when a fresh session has no persisted mode state.
    const entries = sessionEntries(ctx);
    if (!hasModeState(entries) && (ctx?.hasUI || OPENCODE)) restoreConfiguredDefaults();
    else if (!hasModeState(entries)) {
      // A headless root session has no UI to publish the bridge, so Ponytail never loaded; publish the saved modes only while the bridge is clear, or a subagent branch stops inheriting.
      const shared = getSharedComboState();
      if (shared.caveman === 'off' && shared.rtk === 'off' && shared.ponytail === 'off' && shared.pstack === 'off' && shared.headroom === 'off') {
        setSharedComboModes(savedModes(host));
      }
    }
    // Announced last, so any default above is reflected.
    announceStatus(ctx);
  });

  // Resume, branch, and compaction re-announce. A `/new` emits a switch and no start, so a fresh UI session restores the defaults here too.
  for (const event of sessionChangeEvents(pi)) {
    onHostEvent(pi, event, async (_event, ctx) => {
      track(ctx);
      if (ctx?.hasUI && !hasModeState(sessionEntries(ctx))) restoreConfiguredDefaults();
      announceStatus(ctx);
    });
  }

  // The first interactive turn also runs the one-time setup prompt, which a restore event never does.
  onHostEvent(pi, 'agent_start', async (_event, ctx) => {
    track(ctx);
    announceStatus(ctx);
    await runFirstRunSetup(ctx);
  });

  pi.on<SystemPromptEvent>('before_agent_start', async (event, ctx) => {
    if (ctx?.hasUI) reconcile(ctx);
    // Shared state, with no marker check: the marker is a sentence copied out of the host binary, so matching on it would drop Ponytail after a host reworded the line.
    const mode = getSharedComboState().ponytail;
    // On pi, an installed upstream pi-extension is the sole injector, so Tersio only falls back with none.
    if (isPiLikeProcess() && piHasUpstreamPonytail()) return;
    // Match the level's own header: a shared phrase makes every level block the rest, so a `/combo` switch does nothing.
    if (mode === 'off' || systemPromptIncludes(event.systemPrompt, `PONYTAIL MODE ACTIVE — level: ${mode}`)) return;
    const instruction = await loadPonytailInstructions(mode);
    // The previous level's block is replaced, not stacked on.
    const stale = lastInjected;
    lastInjected = instruction;
    return injectPromptText(pi, event, { text: instruction, staleMarker: stale, sectionTag: 'ponytail' });
  });

  // Slash commands only; natural-language input caused accidental toggles and has no reload context.
}
