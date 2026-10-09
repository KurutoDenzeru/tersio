// Dev-only: vendors each brand mark into src/lib/marks so the dashboard never fetches a logo.
// Run with `bun scripts/fetch-marks.ts` from dashboard/app. The CDN is the oracle here, never in the app.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface Source {
  /** Output file name inside src/lib/marks. */
  file: string;
  url: string;
  /** Upstream owner of the mark. The trademark stays with them. */
  owner: string;
  license: string;
}

const SIMPLE_ICONS = 'https://cdn.jsdelivr.net/npm/simple-icons@16/icons';

const SOURCES: Source[] = [
  { file: 'anthropic.svg', url: `${SIMPLE_ICONS}/anthropic.svg`, owner: 'Anthropic', license: 'CC0-1.0' },
  { file: 'google.svg', url: `${SIMPLE_ICONS}/google.svg`, owner: 'Google', license: 'CC0-1.0' },
  { file: 'meta.svg', url: `${SIMPLE_ICONS}/meta.svg`, owner: 'Meta', license: 'CC0-1.0' },
  { file: 'deepseek.svg', url: `${SIMPLE_ICONS}/deepseek.svg`, owner: 'DeepSeek', license: 'CC0-1.0' },
  { file: 'qwen.svg', url: `${SIMPLE_ICONS}/qwen.svg`, owner: 'Alibaba', license: 'CC0-1.0' },
  { file: 'x.svg', url: `${SIMPLE_ICONS}/x.svg`, owner: 'xAI', license: 'CC0-1.0' },
  { file: 'mistralai.svg', url: `${SIMPLE_ICONS}/mistralai.svg`, owner: 'Mistral AI', license: 'CC0-1.0' },
  { file: 'minimax.svg', url: `${SIMPLE_ICONS}/minimax.svg`, owner: 'MiniMax', license: 'CC0-1.0' },
  { file: 'zdotai.svg', url: `${SIMPLE_ICONS}/zdotai.svg`, owner: 'Z.ai', license: 'CC0-1.0' },
  { file: 'xiaomi.svg', url: `${SIMPLE_ICONS}/xiaomi.svg`, owner: 'Xiaomi', license: 'CC0-1.0' },
  { file: 'kimi.svg', url: `${SIMPLE_ICONS}/kimi.svg`, owner: 'Moonshot AI', license: 'CC0-1.0' },
  { file: 'moonshotai.svg', url: `${SIMPLE_ICONS}/moonshotai.svg`, owner: 'Moonshot AI', license: 'CC0-1.0' },
  { file: 'nvidia.svg', url: `${SIMPLE_ICONS}/nvidia.svg`, owner: 'NVIDIA', license: 'CC0-1.0' },
  { file: 'amd.svg', url: `${SIMPLE_ICONS}/amd.svg`, owner: 'AMD', license: 'CC0-1.0' },
  { file: 'ollama.svg', url: `${SIMPLE_ICONS}/ollama.svg`, owner: 'Ollama', license: 'CC0-1.0' },
  { file: 'cline.svg', url: `${SIMPLE_ICONS}/cline.svg`, owner: 'Cline', license: 'CC0-1.0' },
  { file: 'githubcopilot.svg', url: `${SIMPLE_ICONS}/githubcopilot.svg`, owner: 'GitHub', license: 'CC0-1.0' },
  { file: 'openrouter.svg', url: `${SIMPLE_ICONS}/openrouter.svg`, owner: 'OpenRouter', license: 'CC0-1.0' },
  { file: 'github.svg', url: `${SIMPLE_ICONS}/github.svg`, owner: 'GitHub', license: 'CC0-1.0' },
  { file: 'instagram.svg', url: `${SIMPLE_ICONS}/instagram.svg`, owner: 'Instagram', license: 'CC0-1.0' },
  { file: 'groq.svg', url: 'https://groq.com/favicon.svg', owner: 'Groq', license: 'Nominative use of the Groq mark' },
  { file: 'poolside.svg', url: 'https://poolside.ai/favicon/favicon.svg', owner: 'Poolside', license: 'Nominative use of the Poolside mark' },
  { file: 'cerebras.png', url: 'https://cdn.sanity.io/images/e4qjo92p/production/e7a55ae5ab7e2c4fdfd4e66a51f628d1f2f44207-967x967.png?w=256&h=256&fit=max', owner: 'Cerebras', license: 'Nominative use of the Cerebras mark' },
  { file: 'inclusionai.webp', url: 'https://cdn-avatars.huggingface.co/v1/production/uploads/662e1f9da266499277937d33/fyKuazRifqiaIO34xrhhm.jpeg', owner: 'InclusionAI', license: 'Nominative use of the InclusionAI mark' },
];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'src', 'lib', 'marks');

const today = new Date().toISOString().slice(0, 10);

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const ok: Source[] = [];
  const failed: Source[] = [];
  for (const source of SOURCES) {
    try {
      const res = await fetch(source.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length === 0) throw new Error('empty body');
      await writeFile(path.join(OUT, source.file), body);
      ok.push(source);
      console.log(`ok   ${source.file} ${body.length}B`);
    } catch (error) {
      failed.push(source);
      console.log(`FAIL ${source.file} ${(error as Error).message}`);
    }
  }
  const rows = ok.map((s) => `| \`${s.file}\` | ${s.owner} | ${s.license} | <${s.url}> | ${today} |`);
  const doc = [
    '# Brand mark sources',
    '',
    'Every file here is vendored so the dashboard and its exported file never fetch a logo at runtime.',
    'Re-run `bun scripts/fetch-marks.ts` from `dashboard/app` to refresh them.',
    '',
    'Simple Icons files are CC0-1.0. The marks themselves stay the property of their owners, and the',
    'dashboard uses them nominatively, to name the service that served a request. A vendor mark never',
    'stands in for a neutral gateway: those get a monogram tile instead.',
    '',
    '| File | Owner | License | Source | Retrieved |',
    '|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');
  await writeFile(path.join(OUT, 'SOURCES.md'), doc);
  console.log(`\nwrote SOURCES.md (${ok.length} marks${failed.length ? `, ${failed.length} missing` : ''})`);
  if (failed.length) process.exitCode = 1;
}

await main();
