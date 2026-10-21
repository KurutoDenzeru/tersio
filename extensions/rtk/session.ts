import { getSharedComboState, hasModeState, isOmpSubagentPrompt, lastCustomValue, reconcileSharedComboEntries, sessionEntries, setSharedComboListener, setSharedComboMode, systemPromptIncludes } from '../shared/session-state.ts';
import { injectPromptText, isOmpHost, onHostEvent, setExtensionLabel, stringArrayToolParams } from '../shared/host.ts';
import { readRtkDefault } from '../shared/plugin-settings.ts';
import { resolveRtkBinary, shimCommand } from '../shared/utils.ts';
import { announceStatus } from '../shared/status.ts';
import type { ExtensionApi, ExtensionCtx, SessionEntry, SystemPromptEvent } from '../shared/types.ts';

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

// rtk's contract: name the rewritten surface first and the binary second — a hand-typed `rtk` in front of a
// rewritten command fights the rewrite, and the direct calls cover only what the rewrite cannot express.
const RTK_PROMPT_BASE = `RTK guidance active. What you run is condensed automatically, in the host's own rewritten form: searches (grep, rg, ast-grep), listings (ls, find, tree), reads (cat, head, tail), package and test runs (bun, npm, pnpm, npx, cargo, go, pytest, vitest, jest, ctest, tsc), version control and forges (git, gh, glab, gt), containers and clusters (docker, kubectl), cloud and platform CLIs (aws, oc, dotnet), PHP tooling (phpunit, pest, phpstan, pint, ecs), JVM builds (mvn, mvnd, gradlew, sbt), Ruby (rake, rubocop, rspec), Python packaging (pip, uv), Deno (deno), lint and format (eslint, ruff, golangci-lint, mypy, prettier, sqlfluff, playwright, prisma, next), and data tools (jq, curl, wget, psql, wc, make, docker logs). The runner's own subcommand, such as \`rtk bun run test\`, keeps the failing test name, the assertion, and the file and line. Every signal kept, costly noise dropped. Treat a condensed result as complete. Re-run something unfiltered only when its result is empty, garbled, or contradicts its exit code.

Call rtk directly for what the rewrite cannot express: \`rtk read <file> --level aggressive\` for an overview, \`--max-lines N\` for a preview, \`rtk smart <file>\` for a two-line summary, \`rtk summary <cmd>\` for a heuristic one, \`rtk err <cmd>\` for errors only, \`rtk log <file>\` to dedupe logs, \`rtk json <file>\` with \`--keys-only\` for shape, plus \`rtk deps\`, \`rtk diff\`, \`rtk env\`, \`rtk ast-grep\`, and \`rtk test <cmd>\` for a runner without its own form. A command with no condensed form passes through unchanged, so wrap it: \`rtk err node build.js\`, and \`rtk find -name '*.ts'\` in place of fd. Never type \`rtk\` in front of a command listed above. More rtk for what the rewrite cannot reach: \`rtk gain\` for what it saved, \`rtk discover\` for savings it missed, \`rtk session\` for adoption, \`rtk recall <hash>\` to get back an elided output, \`rtk bypass <cmd>\` to run unfiltered but tracked, \`rtk run <cmd>\` for an explicit shell, \`rtk format\` for the universal format check, \`rtk phpt\` for the PHP runner, \`rtk learn\` for corrections from the error history, \`rtk config\` for the settings, and \`rtk pipeline show\` or \`rtk methods list\` for the filter contracts.`;

// The proxy daemon compresses the request traffic, one layer above the shell output. Of our three hosts only
// omp can point its model traffic at it, so the line goes only there.
const RTK_PROXY_PROMPT = ' One layer above the shell: `rtk llm-proxy setup` reports whether the proxy daemon can serve this host, and `rtk llm-proxy start` runs it.';

export default function rtkSessionExtension(pi: ExtensionApi): void {
  let enabled = DEFAULT_ENABLED;

  function fail(text: string) {
    return { isError: true as const, content: [{ type: 'text' as const, text }], details: { enabled } };
  }


  function setEnabled(next: unknown, ctx?: ExtensionCtx): void {
    enabled = Boolean(next);
    pi.appendEntry?.('rtk-mode', { enabled });
    setSharedComboMode('rtk', enabled);
    setRtkProcessEnabled(enabled);
    announceStatus(ctx);
  }

  setExtensionLabel(pi, 'RTK session toggle');

  // Live mirror: a /tersio or /combo switch publishes shared state — adopt it once so the next turn and rtk_run see it.
  function syncFromShared(state: { rtk: string }): void {
    enabled = state.rtk === 'on';
    setRtkProcessEnabled(enabled);
  }
  setSharedComboListener('rtk', syncFromShared);
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
    description: 'Run a shell command through the installed `rtk` binary when RTK mode is on, and run it plainly when RTK mode is off.',
    parameters: stringArrayToolParams(pi, 'args', {
      minItems: 1,
      description: "Arguments passed to rtk, e.g. ['git','status'] or ['read','src/index.ts']",
    }),
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      // A subagent's own flag sits at its start-up default, so honour shared state too.
      const rtkOn = enabled || getSharedComboState().rtk === 'on';
      if (typeof pi.exec !== 'function') return fail('This host cannot run rtk.');
      // RTK off: run the command as given rather than answering "mode is off". The tool is the only one left under --no-tools, and a refusal there made the model spend turns re-calling it. rtk is the condenser, never the command.
      const cwd = ctx?.cwd || pi.cwd;
      const bin = rtkOn ? resolveRtkBinary() : null;
      if (rtkOn && bin === null) return fail('RTK mode is on but the rtk binary is not installed. Run: tersio update');
      const argv = params.args;
      onUpdate?.({ content: [{ type: 'text', text: `${bin === null ? '' : 'rtk '}${argv.join(' ')}` }], details: { phase: 'start' } });
      try {
        // A GUI-launched host may lack ~/.bun/bin on PATH, so prefer the resolved path.
        // A `.cmd` shim cannot be spawned directly on Windows, so it runs through the shell.
        const shim = shimCommand(bin ?? argv[0], argv);
        const result = await pi.exec(shim.cmd, shim.args, { signal, cwd });
        const text = [result.stdout, result.stderr].filter(Boolean).join('\n');
        return {
          isError: result.code !== 0,
          content: [{ type: 'text', text: text || `exited ${result.code}` }],
          details: { code: result.code, killed: result.killed, enabled, condensed: bin !== null },
        };
      } catch (e) {
        return fail(`${bin === null ? argv[0] : 'rtk'} could not run: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  });

  function restoreEnabled(ctx?: ExtensionCtx): void {
    const entries = sessionEntries(ctx);
    // A subagent's branch has no Tersio entries; reconciling it would wipe shared state.
    if (hasModeState(entries)) reconcileSharedComboEntries(entries);
    // Persisted session state wins; a fresh session falls back to the installer/user default (off unless configured).
    const persisted = resolveEnabled(entries);
    enabled = typeof persisted === 'boolean' ? persisted : enabled || readRtkDefault();
    setRtkProcessEnabled(enabled);
    announceStatus(ctx);
  }

  // Start, resume, and branch all land here, so every session type shows it.
  pi.on('session_start', async (_event, ctx) => {
    restoreEnabled(ctx);
  });

  onHostEvent(pi, 'session_branch', async (_event, ctx) => {
    restoreEnabled(ctx);
  });

  pi.on('session_tree', async (_event, ctx) => {
    restoreEnabled(ctx);
  });

  onHostEvent(pi, 'session_switch', async (_event, ctx) => {
    restoreEnabled(ctx);
  });

  onHostEvent(pi, 'session_compact', async (_event, ctx) => {
    restoreEnabled(ctx);
  });

  pi.on<SystemPromptEvent>('before_agent_start', async (event) => {
    const active = isOmpSubagentPrompt(event.systemPrompt) ? getSharedComboState().rtk === 'on' : enabled;
    if (!active) return;
    const prompt = isOmpHost(pi) ? RTK_PROMPT_BASE + RTK_PROXY_PROMPT : RTK_PROMPT_BASE;
    // Skip when already present, so a host that re-presents the prompt cannot stack it.
    if (systemPromptIncludes(event.systemPrompt, prompt)) return;
    return injectPromptText(pi, event, { text: prompt, sectionTag: 'rtk' });
  });
}
