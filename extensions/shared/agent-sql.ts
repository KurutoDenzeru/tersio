// SQL fragments for the usage store. Kept apart from aggregation so a schema read and a metric
// read do not share one thousand-line module.

/** The row shape every query groups by: a message joined to its file, since path and facts live apart. */
export const SOURCE = 'messages m JOIN files f ON f.id = m.file_id';

/** The transcript path with any host-side row suffix removed, so one file groups as one session. */
export const FILE_KEY = `substr(f.path, 1, instr(f.path || '#', '#') - 1)`;

/** Model-id spellings whose dashboard mark lives under another name; the first segment names the gateway. */
const PROVIDER_ALIASES: Readonly<Record<string, string>> = {
  'opencode-zen': 'opencode',
  'opencode-go': 'opencode',
  'gmi-cloud': 'gmicloud',
  'charm-hyper': 'charmhyper',
  'kimi-code': 'kimi',
  'openai-codex': 'codex',
  'github-copilot': 'githubcopilot',
  'ollama-cloud': 'ollama',
  'amd-radeon-cloud-cn': 'amd',
  'google-antigravity': 'google',
  devin: 'cognition',
};

/** SQL: the gateway that served the row. The transcript names it, and that name wins, because a model id cannot show it. */
function providerExpr(model: string, named?: string): string {
  const seg = `substr(${model}, 1, instr(${model} || '/', '/') - 1)`;
  const alias = `ltrim(${seg}, '~')`;
  const cases = Object.entries(PROVIDER_ALIASES)
    .map(([from, to]) => `WHEN '${from}' THEN '${to}'`)
    .join(' ');
  const fromModel = `CASE WHEN instr(${model}, '/') = 0 THEN '' ELSE CASE ${alias} ${cases} ELSE ${alias} END END`;
  if (!named) return fromModel;
  return `CASE WHEN ${named} IS NULL OR ${named} = '' THEN ${fromModel} ELSE ${named} END`;
}

/** SQL: the project from a transcript's session folder; the separator follows the stored path. */
function projectExpr(file: string): string {
  const posAt = `instr(${file}, '/sessions/')`;
  const posWin = `instr(${file}, '\\sessions\\')`;
  const at = `CASE WHEN ${posAt} > 0 THEN ${posAt} ELSE ${posWin} END`;
  const sep = `CASE WHEN ${posAt} > 0 THEN '/' WHEN ${posWin} > 0 THEN '\\' WHEN instr(${file}, '\\') > 0 THEN '\\' ELSE '/' END`;
  const seg = `substr(${file}, ${at} + 10, instr(substr(${file}, ${at} + 10) || ${sep}, ${sep}) - 1)`;
  const base = `replace(${file}, rtrim(${file}, replace(${file}, ${sep}, '')), '')`;
  const dir = `substr(${file}, 1, length(${file}) - length(${base}) - 1)`;
  const dirBase = `replace(${dir}, rtrim(${dir}, replace(${dir}, ${sep}, '')), '')`;
  return `CASE WHEN ${at} > 0 THEN ${seg} ELSE ${dirBase} END`;
}

/** Every column a query reads, mapped to the store's schema in one place. */
export const COL = {
  session: FILE_KEY,
  entry: `COALESCE(m.id, '')`,
  folder: projectExpr(FILE_KEY),
  model: 'm.model',
  provider: providerExpr('m.model', 'm.p'),
  api: "''",
  timestamp: 'm.t',
  bucket: `CAST(COALESCE(m.t, 0) AS INTEGER)`,
  duration: 'm.d',
  ttft: 'm.tf',
  stopReason: `CASE m.st WHEN 'error' THEN 'error' WHEN 'aborted' THEN 'aborted' ELSE 'stop' END`,
  errorMessage: 'm.note',
  input: 'm.i',
  output: 'm.o',
  cacheRead: 'm.cr',
  cacheWrite: 'm.cw',
  total: '(m.i + m.o + m.cr + m.cw)',
  costTotal: 'COALESCE(m.usd, 0)',
  agentType: `COALESCE(m.a, 'main')`,
  host: `COALESCE(m.h, '')`,
  costInput: '0',
  costCacheRead: '0',
  costCacheWrite: '0',
  unpriced: '0',
} as const;
