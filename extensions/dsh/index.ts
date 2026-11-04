// Tersio on DeepSeek Harness: modes as always-on system-prompt sections; imports stay relative for Node type stripping.
import { readFileSync, writeFileSync } from 'node:fs';
import { exec, execFile } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { homeDir, resolveRtkBinary, tersioHome } from '../shared/utils.ts';
import { formatModeLine, MODE_GLYPHS, type ModeSnapshot } from '../shared/mode-notice.ts';

const execFileP = promisify(execFile);
const execShellP = promisify(exec);
const HERE = dirname(fileURLToPath(import.meta.url));

// The level-to-file map caveman/index.ts uses; `megacave` and retired wenyan names fall back to `full`.
const CAVEMAN_RULE_FILES: Record<string, string> = {
  lite: 'rule-lite.md', full: 'rule.md', ultra: 'rule-ultra.md',
  'megacave-lite': 'rule-megacave-lite.md', 'megacave-full': 'rule-megacave.md', 'megacave-ultra': 'rule-megacave-ultra.md',
};

// The combo presets, copied from cli/common.ts so `/combo` matches the installer bug-for-bug.
const COMBO_PRESETS: Record<string, { caveman: string; rtk: boolean; ponytail: string }> = {
  off: { caveman: 'off', rtk: false, ponytail: 'off' },
  lite: { caveman: 'lite', rtk: true, ponytail: 'lite' },
  balanced: { caveman: 'full', rtk: true, ponytail: 'full' },
  max: { caveman: 'ultra', rtk: true, ponytail: 'ultra' },
};

const RETIRED_CAVEMAN: Record<string, string> = {
  wenyan: 'megacave-full', 'wenyan-lite': 'megacave-lite', 'wenyan-full': 'megacave-full', 'wenyan-ultra': 'megacave-ultra', megacave: 'megacave-full',
};

interface Store { [key: string]: unknown }

function readStore(): Store {
  try { return JSON.parse(readFileSync(join(tersioHome(), 'settings.json'), 'utf8')) as Store; } catch { return {}; }
}

/** Writes the dsh host's own section, so a mode switch here never rewrites another agent's defaults. */
function writeHostSection(mutate: (section: Record<string, unknown>) => void): void {
  const file = join(tersioHome(), 'settings.json');
  let store: Store = {};
  try { store = JSON.parse(readFileSync(file, 'utf8')) as Store; } catch { /* a missing or broken store starts fresh */ }
  const hosts = (store.hosts && typeof store.hosts === 'object' ? store.hosts : {}) as Record<string, Record<string, unknown>>;
  const section = (hosts.dsh && typeof hosts.dsh === 'object' ? hosts.dsh : {}) as Record<string, unknown>;
  mutate(section);
  hosts.dsh = section;
  store.hosts = hosts;
  writeFileSync(file, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}


function hostSection(store: Store): Store {
  const hosts = store.hosts as Record<string, Store> | undefined;
  return (hosts && typeof hosts === 'object' ? hosts.dsh : undefined) ?? {};
}

function setting(store: Store, section: Store, key: string): unknown {
  return section[key] !== undefined ? section[key] : store[key];
}

function cavemanBody(level: string): string {
  const name = CAVEMAN_RULE_FILES[level] ?? CAVEMAN_RULE_FILES.full;
  try {
    return readFileSync(join(HERE, '..', 'caveman', name), 'utf8');
  } catch {
    return `Caveman ${level} requested, but ${name} is missing. Run: tersio doctor --fix extensions`;
  }
}

function ponytailBody(level: string): string {
  // The level filter is a compact copy of ponytail-instructions.ts until the installer stages a shared rules dir.
  let body: string;
  try {
    body = readFileSync(join(HERE, '..', 'ponytail', 'skills', 'ponytail', 'SKILL.md'), 'utf8');
  } catch {
    return `Ponytail ${level} requested, but its SKILL.md is missing. Run: tersio doctor --fix ponytail`;
  }
  const withoutFrontmatter = body.replace(/^---[\s\S]*?---\s*/, '');
  const rows = withoutFrontmatter
    .split(/\r?\n/)
    .filter((line) => {
      const tableLabel = line.match(/^\|\s*\*\*(.+?)\*\*\s*\|/);
      if (tableLabel) return tableLabel[1].trim().toLowerCase() === level;
      const exampleLabel = line.match(/^-\s*([^:]+):\s*"/);
      if (exampleLabel) return exampleLabel[1].trim().toLowerCase() === level;
      return true;
    })
    .join('\n');
  return rows;
}

function pstackBlock(): string {
  const dir = join(HERE, '..', 'pstack');
  try {
    const body = readFileSync(join(dir, 'rule.md'), 'utf8');
    // The rule body names its files by relative path, so one line gives the directory they sit in.
    const home = `Leaves, playbooks, and skills live at: ${dir} — \`principles/<title>.md\`, \`playbooks/<title>.md\`, \`skills/<name>/SKILL.md\`, \`references/<title>.md\`.`;
    return `pstack mode active for this session.\n${body}\n${home}`;
  } catch {
    return `pstack mode requested, but rule.md is missing. Run: tersio doctor --fix extensions`;
  }
}

function buildBlocks(): string {
  const store = readStore();
  const section = hostSection(store);
  const parts: string[] = [];

  const cavemanRaw = String(setting(store, section, 'cavemanDefault') ?? 'off').trim().toLowerCase();
  const caveman = cavemanRaw !== 'off' ? cavemanRaw : null;
  if (caveman) parts.push(`Caveman ${caveman} active for this session.\n${cavemanBody(caveman)}`);

  if (setting(store, section, 'rtkDefault') === true) {
    parts.push('🗜️ RTK MODE ACTIVE — level: on.\nRun every shell command through the `rtk_run` tool; it condenses output automatically. What you run is condensed: searches (grep, rg), listings (ls, find), reads (cat, head, tail), package and test runs (bun, npm, pnpm, pytest, cargo), version control and forges (git, gh), containers (docker, kubectl), and cloud CLIs. A failing run keeps the failing test name, the assertion, and the file and line.');
  }

  const ponytail = String(setting(store, section, 'ponytailDefault') ?? 'off').trim().toLowerCase();
  if (ponytail !== 'off') parts.push(`PONYTAIL MODE ACTIVE — level: ${ponytail}\n\n${ponytailBody(ponytail)}`);

  if (setting(store, section, 'pstackDefault') === 'on') parts.push(pstackBlock());

  return parts.join('\n\n');
}

function runThroughRtk(command: string): Promise<{ content: string }> {
  const bin = resolveRtkBinary();
  if (!bin) return Promise.resolve({ content: 'rtk is not installed. Run: tersio doctor --fix rtk' });
  return execFileP(bin, ['run', command], { timeout: 600_000, maxBuffer: 16 * 1024 * 1024 })
    .then((r) => ({ content: `${r.stdout}\n${r.stderr}`.trim() || '(no output)' }))
    .catch((e: { stdout?: string; stderr?: string; message?: string }) => ({
      content: `${e.stdout ?? ''}\n${e.stderr ?? ''}\n${e.message ?? ''}`.trim() || 'the command failed without output',
    }));
}

interface DshTools {
  register(tool: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    output: { schema: unknown; render?: (args: unknown, value: unknown) => Array<{ type: string; text: string }> };
    execute: (args: Record<string, string>) => Promise<{ content: string }> | { content: string };
  }): () => void;
}

interface DshRoute {
  kind: 'exact' | 'prefix';
  path: string;
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}

interface DshCtx {
  systemPrompt: {
    section(section: { name: string; order: number; text: string | ((context: unknown) => string); interpolate?: boolean }): () => void;
  };
  tools: DshTools;
  commands: DshCommands;
  /** Present on the Web profile; a headless composition simply has no status bar to feed. */
  webServer?: { register(route: DshRoute): () => void };
  effect?: (callback: () => () => void) => () => void;
  /** Optional dependency: the nested fiber waits for the carrier instead of blocking the whole plugin. */
  inject?: (deps: string[], callback: (scoped: DshCtx) => void) => unknown;
}

interface DshAgent {
  id: string;
}

interface DshCommands {
  register(command: {
    name: string;
    description: string;
    input?: { hint: string };
    recordInput?: boolean;
    handler: (context: { agent: DshAgent; rawInput: string; signal: { throwIfAborted(): void } }) => Promise<{ kind: string; text: string }>;
  }): () => void;
}

export const name = 'tersio-dsh';
export const inject = ['tools', 'systemPrompt', 'commands'];

function readModes(store: Store, section: Store): ModeSnapshot {
  return {
    caveman: String(setting(store, section, 'cavemanDefault') ?? 'off'),
    rtk: setting(store, section, 'rtkDefault') === true,
    ponytail: String(setting(store, section, 'ponytailDefault') ?? 'off'),
    pstack: setting(store, section, 'pstackDefault') as string | boolean ?? 'off',
    // dsh is a native route host: the installer points the provider at Headroom's proxy, so the stored
    // default is the truth and the bar reports it instead of promising a mode the host cannot honour.
    headroom: setting(store, section, 'headroomDefault') === 'on' ? 'on' : 'off',
  };
}

function modeLine(store: Store, section: Store): string {
  return formatModeLine(readModes(store, section));
}

/** The preset the three preset-owned modes add up to, or `custom` when they were mixed by hand. */
function statusLevel(modes: ModeSnapshot): string {
  for (const [level, preset] of Object.entries(COMBO_PRESETS)) {
    if (preset.caveman === modes.caveman && preset.rtk === modes.rtk && preset.ponytail === modes.ponytail) return level;
  }
  return 'custom';
}

/** The bar line: the preset, then one glyph per mode, short enough to fit a narrow composer. */
function statusLine(store: Store, section: Store): string {
  const modes = readModes(store, section);
  const pstack = modes.pstack === true || modes.pstack === 'on' ? 'on' : 'off';
  const level = statusLevel(modes);
  if (level === 'off' && pstack === 'off' && modes.headroom === 'off') return '🧩 OFF';
  const label = level === 'off' || level === 'custom' ? 'CUSTOM' : level.toUpperCase();
  const value = (mode: string | boolean) => (mode === true || mode === 'on' ? 'ON' : mode === false || mode === 'off' ? 'OFF' : String(mode).toUpperCase());
  return `🧩 ${label} | ${MODE_GLYPHS.caveman} caveman:${value(modes.caveman)} | ${MODE_GLYPHS.rtk} rtk:${value(modes.rtk)} | ${MODE_GLYPHS.headroom} headroom:${value(modes.headroom)} | ${MODE_GLYPHS.ponytail} ponytail:${value(modes.ponytail)} | ${MODE_GLYPHS.pstack} pstack:${value(pstack)}`;
}

/** One payload for the bar: the rendered line, the preset level, and each mode's value. */
function statusPayload(): string {
  const store = readStore();
  const section = hostSection(store);
  const modes = readModes(store, section);
  return JSON.stringify({ text: statusLine(store, section), level: statusLevel(modes), modes });
}

/** Values the bar's popover may write; each maps onto the same host defaults the CLI and dashboard store. */
const SWITCHABLE: Record<string, readonly string[]> = {
  caveman: ['off', 'lite', 'full', 'ultra', 'megacave-lite', 'megacave-full', 'megacave-ultra'],
  rtk: ['off', 'on'],
  ponytail: ['off', 'lite', 'full', 'ultra'],
  pstack: ['off', 'on'],
  headroom: ['off', 'on'],
};

function applySwitch(mode: string, value: string): boolean {
  if (!SWITCHABLE[mode]?.includes(value)) return false;
  writeHostSection((section) => {
    if (mode === 'rtk') section.rtkDefault = value === 'on';
    else section[`${mode}Default`] = value;
  });
  return true;
}

function applyCombo(level: string): boolean {
  const preset = COMBO_PRESETS[level];
  if (!preset) return false;
  writeHostSection((section) => {
    section.comboDefault = level;
    section.cavemanDefault = preset.caveman;
    section.rtkDefault = preset.rtk;
    section.ponytailDefault = preset.ponytail;
  });
  return true;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4096) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** `/tersio/modes` feeds the Web bar: GET renders it, POST switches a preset or one mode from the popover. */
function registerStatusRoute(ctx: DshCtx): void {
  if (!ctx.inject) return;
  ctx.inject(['webServer'], (scoped) => {
    const webServer = scoped.webServer;
    if (!webServer) return;
    const route: DshRoute = {
      kind: 'exact',
      path: '/tersio/modes',
      handler: async (req, res) => {
        const send = (status: number, body: string) => {
          res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          res.end(req.method === 'HEAD' ? undefined : body);
        };
        if (req.method === 'GET' || req.method === 'HEAD') return send(200, statusPayload());
        if (req.method !== 'POST') return send(405, '{"error":"use GET or POST"}');
        let change: { combo?: unknown; mode?: unknown; value?: unknown };
        try {
          change = JSON.parse(await readBody(req)) as typeof change;
        } catch {
          return send(400, '{"error":"invalid body"}');
        }
        const applied = typeof change.combo === 'string'
          ? applyCombo(change.combo)
          : typeof change.mode === 'string' && typeof change.value === 'string'
            ? applySwitch(change.mode, change.value)
            : false;
        return applied ? send(200, statusPayload()) : send(400, '{"error":"unknown mode change"}');
      },
    };
    // The carrier throws on a duplicate (kind, path), so the nested fiber owns the disposer.
    scoped.effect?.(() => webServer.register(route));
  });
}

// Writes the dsh section and returns the status line; unlike the desktop hosts there is no chat message,
// because the bar above the composer already shows the change.
function applyModeChange(mutate: (section: Record<string, unknown>) => void): string {
  writeHostSection(mutate);
  const store = readStore();
  return modeLine(store, hostSection(store));
}

function registerCommands(ctx: DshCtx): void {
  const commands: Array<Parameters<DshCommands['register']>[0]> = [
    {
      name: 'combo',
      description: 'Set the Tersio Combo preset: off, lite, balanced, or max',
      input: { hint: 'off | lite | balanced | max' },
      handler: async ({ rawInput }) => {
        const level = String(rawInput || 'off').trim().toLowerCase();
        const preset = COMBO_PRESETS[level];
        if (!preset) return { kind: 'success', text: `Unknown combo level: ${level || '(none)'}. Levels: off, lite, balanced, max.` };
        const modes = applyModeChange((section) => {
          section.comboDefault = level;
          section.cavemanDefault = preset.caveman;
          section.rtkDefault = preset.rtk;
          section.ponytailDefault = preset.ponytail;
        });
        return { kind: 'success', text: `Combo set to ${level}: ${modes}` };
      },
    },
    {
      name: 'caveman',
      description: 'Set the Caveman voice level',
      input: { hint: 'off | lite | full | ultra | megacave-*' },
      handler: async ({ rawInput }) => {
        const level = String(rawInput || 'off').trim().toLowerCase();
        const mapped = RETIRED_CAVEMAN[level] ?? level;
        if (mapped !== 'off' && !CAVEMAN_RULE_FILES[mapped]) return { kind: 'success', text: `Unknown caveman level: ${level}. Levels: off, lite, full, ultra, megacave-lite, megacave-full, megacave-ultra.` };
        const modes = applyModeChange((section) => { section.cavemanDefault = mapped; });
        return { kind: 'success', text: mapped === 'off' ? `Caveman off. ${modes}` : `Caveman set to ${mapped}: ${modes}` };
      },
    },
    {
      name: 'rtk',
      description: 'Turn the RTK shell condensation on or off',
      input: { hint: 'on | off' },
      handler: async ({ rawInput }) => {
        const raw = String(rawInput || '').trim().toLowerCase();
        const on = raw === '' ? null : ['on', 'enable', 'true'].includes(raw) ? true : ['off', 'disable', 'false'].includes(raw) ? false : null;
        if (on === null) return { kind: 'success', text: 'Usage: /rtk on | /rtk off' };
        const modes = applyModeChange((section) => { section.rtkDefault = on; });
        return { kind: 'success', text: `RTK ${on ? 'on' : 'off'}: ${modes}` };
      },
    },
    {
      name: 'ponytail',
      description: 'Set the Ponytail level',
      input: { hint: 'off | lite | full | ultra' },
      handler: async ({ rawInput }) => {
        const level = String(rawInput || 'off').trim().toLowerCase();
        if (level !== 'off' && level !== 'lite' && level !== 'full' && level !== 'ultra') return { kind: 'success', text: `Unknown ponytail level: ${level}. Levels: off, lite, full, ultra.` };
        const modes = applyModeChange((section) => { section.ponytailDefault = level; });
        return { kind: 'success', text: `Ponytail set to ${level}: ${modes}` };
      },
    },
    {
      name: 'pstack',
      description: 'Turn the pstack rigor mode on or off',
      input: { hint: 'on | off' },
      handler: async ({ rawInput }) => {
        const raw = String(rawInput || 'off').trim().toLowerCase();
        const on = raw === 'on' ? true : raw === 'off' ? false : null;
        if (on === null) return { kind: 'success', text: 'Usage: /pstack on | /pstack off' };
        const modes = applyModeChange((section) => { section.pstackDefault = on ? 'on' : 'off'; });
        return { kind: 'success', text: `pstack ${on ? 'on' : 'off'}: ${modes}` };
      },
    },
    {
      name: 'tersio',
      description: 'Show the current Tersio modes in this DeepSeek Harness session',
      handler: async () => {
        const store = readStore();
        const modes = modeLine(store, hostSection(store));
        return { kind: 'success', text: `Tersio modes: ${modes}. Change them with /combo, /caveman, /rtk, /ponytail, or /pstack.` };
      },
    },
  ];
  for (const command of commands) ctx.commands.register(command);
  if (process.env.TERSIO_DSH_DEBUG) console.log(`[tersio-dsh] commands registered: ${commands.map((c) => `/${c.name}`).join(' ')}`);
}

export function apply(ctx: DshCtx): void {
  const store = readStore();
  const section = hostSection(store);
  console.log(`[tersio-dsh] armed: ${modeLine(store, section)}`);

  registerCommands(ctx);
  registerStatusRoute(ctx);

  // A provider, not a static string: the store is re-read at every assembly, so a mode switch applies without a restart.
  ctx.systemPrompt.section({
    name: 'tersio-modes',
    order: 50_000,
    text: () => {
      const blocks = buildBlocks();
      if (process.env.TERSIO_DSH_DEBUG) console.log(`[tersio-dsh] assembly: ${blocks.length} chars of mode blocks`);
      return blocks;
    },
  });

  ctx.tools.register({
    name: 'rtk_run',
    description: 'Run a shell command through the rtk binary when RTK mode is on, and run it plainly when RTK mode is off.',
    parameters: {
      command: { type: 'string', required: true },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute({ command }) {
      // Re-read at call time, so a mode switch applies without remounting the plugin.
      const live = readStore();
      const liveSection = hostSection(live);
      if (setting(live, liveSection, 'rtkDefault') === true && resolveRtkBinary() !== null) return runThroughRtk(command);
      // Same contract as the other hosts: with RTK off the command runs plainly.
      const r = await execShellP(command, { cwd: homeDir(), timeout: 600_000, maxBuffer: 16 * 1024 * 1024 });
      return { content: `${r.stdout}\n${r.stderr}`.trim() || '(no output)' };
    },
  });
}
