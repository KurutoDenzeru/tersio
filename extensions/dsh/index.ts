// Tersio on DeepSeek Harness: mounts the modes as always-on system-prompt sections.
// Runs on Node ^22.19 (type stripping), so imports stay erasable and relative to this package tree,
// which is where the rule bodies live — no copies.
import { readFileSync } from 'node:fs';
import { exec, execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { homeDir, resolveRtkBinary, tersioHome } from '../shared/utils.ts';

const execFileP = promisify(execFile);
const execShellP = promisify(exec);
const HERE = dirname(fileURLToPath(import.meta.url));

// The same level-to-file mapping caveman/index.ts uses; `megacave` and the retired
// wenyan names fall back to `full`, matching the other hosts bug-for-bug.
const CAVEMAN_RULE_FILES: Record<string, string> = {
  lite: 'rule-lite.md', full: 'rule.md', ultra: 'rule-ultra.md',
  'megacave-lite': 'rule-megacave-lite.md', 'megacave-full': 'rule-megacave.md', 'megacave-ultra': 'rule-megacave-ultra.md',
};

interface Store { [key: string]: unknown }

function readStore(): Store {
  try { return JSON.parse(readFileSync(join(tersioHome(), 'settings.json'), 'utf8')) as Store; } catch { return {}; }
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

  if (setting(store, section, 'headroomDefault') === 'on') {
    parts.push('🍃 HEADROOM MODE ACTIVE — level: on\nHeadroom compression is enabled for this session: tool outputs, file reads, and history may be compressed before reaching you. A compressed result can elide details; treat its elision markers as real. Recover the original before acting on missing detail: run `headroom inspect`, or call the headroom_retrieve MCP tool where wired.');
  }

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

interface DshCtx {
  systemPrompt: {
    section(section: { name: string; order: number; text: string | ((context: unknown) => string); interpolate?: boolean }): () => void;
  };
  tools: DshTools;
}

export const name = 'tersio-dsh';
export const inject = ['tools', 'systemPrompt'];

export function apply(ctx: DshCtx): void {
  const store = readStore();
  const section = hostSection(store);
  const state = [
    ['caveman', String(setting(store, section, 'cavemanDefault') ?? 'off')],
    ['rtk', `${setting(store, section, 'rtkDefault') === true && resolveRtkBinary() !== null ? 'on' : 'off'}`],
    ['ponytail', String(setting(store, section, 'ponytailDefault') ?? 'off')],
    ['pstack', String(setting(store, section, 'pstackDefault') ?? 'off')],
    ['headroom', setting(store, section, 'headroomDefault') === 'on' ? 'on' : 'off'],
  ] as const;
  console.log(`[tersio-dsh] armed: ${state.map(([k, v]) => `${k}=${v}`).join(' ')}`);

  // A provider, not a static string: the store is re-read at every assembly, so a mode switch applies without a restart.
  ctx.systemPrompt.section({
    name: 'tersio-modes',
    order: 50_000,
    text: () => buildBlocks(),
  });

  ctx.tools.register({
    name: 'rtk_run',
    description: 'Run a shell command through the rtk binary when RTK mode is on, and run it plainly when RTK mode is off.',
    parameters: {
      command: { type: 'string', required: true },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute({ command }) {
      const store = readStore();
      const section = hostSection(store);
      if (setting(store, section, 'rtkDefault') === true && resolveRtkBinary() !== null) return runThroughRtk(command);
      // Same contract as the other hosts: with RTK off the command runs plainly.
      const r = await execShellP(command, { cwd: homeDir(), timeout: 600_000, maxBuffer: 16 * 1024 * 1024 });
      return { content: `${r.stdout}\n${r.stderr}`.trim() || '(no output)' };
    },
  });
}
