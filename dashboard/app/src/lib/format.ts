// Formatting, currency, vendor, and zone helpers shared across views.

export interface TokenBreakdown {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export function fmt(n: number): string {
  return Number(n).toLocaleString("en-US");
}

export function fmtShort(n: number): string {
  if (n >= 1e12) return (n / 1e12).toFixed(1) + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "–";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export const CURS: Record<string, { s: string; d: number }> = {
  USD: { s: "$", d: 2 },
  PHP: { s: "₱", d: 2 },
  EUR: { s: "€", d: 2 },
  GBP: { s: "£", d: 2 },
  JPY: { s: "¥", d: 0 },
  KRW: { s: "₩", d: 0 },
  SGD: { s: "S$", d: 2 },
  AUD: { s: "A$", d: 2 },
  CAD: { s: "C$", d: 2 },
  INR: { s: "₹", d: 2 },
};

export const FLAGS: Record<string, string> = {
  USD: "🇺🇸",
  PHP: "🇵🇭",
  EUR: "🇪🇺",
  GBP: "🇬🇧",
  JPY: "🇯🇵",
  KRW: "🇰🇷",
  SGD: "🇸🇬",
  AUD: "🇦🇺",
  CAD: "🇨🇦",
  INR: "🇮🇳",
};

export const FX_SNAPSHOT: Record<string, number> = {
  USD: 1,
  PHP: 58.7,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 149.8,
  KRW: 1385,
  SGD: 1.34,
  AUD: 1.52,
  CAD: 1.37,
  INR: 88.2,
};

export function isCurrencyCode(code: string): boolean {
  return Object.hasOwn(CURS, code);
}

// Small amounts keep extra decimals to stay readable.
export function moneyDecimals(v: number, base: number): number {
  const a = Math.abs(v);
  if (a >= 0.1 || a === 0) return base;
  if (a >= 0.001) return Math.max(base, 4);
  if (a >= 0.00001) return Math.max(base, 6);
  return Math.max(base, 8);
}

export function fxMoney(v: number, cur: string, rates: Record<string, number>): string {
  const c = CURS[cur] ?? CURS.USD;
  const r = rates[cur] ?? 1;
  const amt = v * r;
  const d = moneyDecimals(amt, c.d);
  return c.s + amt.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function dayTotal(b: Partial<TokenBreakdown>): number {
  return (b.input ?? 0) + (b.output ?? 0) + (b.cacheRead ?? 0) + (b.cacheWrite ?? 0);
}

export function modelTotal(byModel: Record<string, TokenBreakdown>, m: string): number {
  const b = byModel[m] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  return b.input + b.output + b.cacheRead + b.cacheWrite;
}

export function topModels(byModel: Record<string, TokenBreakdown>, n: number): string[] {
  return Object.keys(byModel)
    .sort((a, b) => modelTotal(byModel, b) - modelTotal(byModel, a))
    .slice(0, n);
}

function cap(s: string): string {
  const low = s.toLowerCase();
  if (low === "openai") return "OpenAI";
  if (low === "gpt") return "GPT";
  if (low === "swe") return "SWE";
  if (low === "ai") return "AI";
  if (/^\d+[a-z]+$/.test(low)) return low.toUpperCase();
  if (s.length <= 2) return s.toUpperCase();
  return s[0].toUpperCase() + s.slice(1).toLowerCase();
}

function seg(s: string): string {
  return s.split(".").map(cap).join(".");
}

function words(s: string): string {
  return s
    .split(/[-_:]+/)
    .filter(Boolean)
    .map(seg)
    .join("-");
}

// Vendor-first labels, so provider-prefixed keys read as "Anthropic - Claude - Haiku-4.5".
export function displayModel(m: string): string {
  const bare = String(m).replace(/(?::free|-free)$/i, "");
  // The report already folds keys; folding again would lowercase the caps.
  if (bare.includes(" - ")) return bare;
  const segs = bare.split("/").filter(Boolean);
  const tail = segs[segs.length - 1] ?? bare;
  // One free model under two spellings; fold the alpha variant onto it.
  const pretty = /^space-bunny(-alpha)?$/i.test(tail) ? "Space-Bunny" : words(tail);
  const vendor = vendorOf(bare);
  if (vendor.name === "Other") return segs.length > 1 ? `${words(segs[segs.length - 2])} - ${pretty}` : pretty;
  const claude = pretty.match(/^claude[-_](.+)$/i);
  if (vendor.name === "Anthropic" && claude) return `Anthropic - Claude - ${claude[1]}`;
  if (pretty.toLowerCase().startsWith(vendor.name.toLowerCase())) return pretty;
  return `${vendor.name} - ${pretty}`;
}

export interface Vendor {
  name: string;
  slug: string;
  color: string;
}

// Family first: gateway segments shadow it (minimaxai holds xai, gemma rides nvidia).
const PROVIDERS: Array<[RegExp, string, string, string]> = [
  [/inclusionai|ling-/i, "InclusionAI", "inclusionai", "#78716c"],
  [/minimax/i, "MiniMax", "minimax", "#e11d48"],
  [/grok|xai/i, "xAI", "x", "#000"],
  [/stealth|space-bunny/i, "Stealth", "stealth", "#1f2937"],
  [/openai|codex|gpt-|o1/i, "OpenAI", "openai", "#fff"],
  [/muse|llama/i, "Meta", "meta", "#0082fb"],
  [/deepseek/i, "DeepSeek", "deepseek", "#4d6bfe"],
  [/qwen|qwq/i, "Alibaba", "qwen", "#6950EF"],
  [/glm|z-ai|zhipu/i, "Z.ai", "zdotai", "#2D2D2D"],
  [/mimo/i, "Xiaomi", "xiaomi", "#ff6900"],
  [/kimi|moonshot/i, "Moonshot", "kimi", "#a855f7"],
  [/^\s*k3\s*$/i, "Moonshot", "kimi", "#a855f7"],
  [/step[-_]?\d/i, "StepFun", "", "#0ea5e9"],
  [/typesafe\/jev/i, "Typesafe", "", "#22c55e"],
  [/meituan|longcat/i, "Meituan", "", "#facc15"],
  [/poolside|laguna/i, "Poolside", "poolside", "#4137ff"],
  [/tencent|hy3/i, "Tencent", "", "#0052d9"],
  [/mistral/i, "Mistral", "mistralai", "#ff7000"],
  [/claude|anthropic/i, "Anthropic", "anthropic", "#d97757"],
  [/gemini|google|gemma/i, "Google", "google", "#4285F4"],
  [/nemotron|nvidia/i, "NVIDIA", "nvidia", "#76b900"],
  // `swe-*` is Cognition's Devin line; anchored so it cannot swallow other names.
  [/devin|cognition|^swe[-/]/i, "Cognition", "cognition", "#0b0b0b"],
  // Empty slug draws the local glyph instead of a broken image.
];

export function vendorOf(model: string): Vendor {
  for (const [re, name, slug, color] of PROVIDERS) {
    if (re.test(model)) return { name, slug, color };
  }
  return { name: "Other", slug: "", color: "#71717a" };
}

// Host glyph identifies the agent without opening the row.
export interface HostMeta {
  label: string;
  icon: string;
  color: string;
}
export function hostMeta(host?: string): HostMeta {
  if (host === "omp") return { label: "OMP", icon: "square-terminal", color: "#a78bfa" };
  if (host === "opencode") return { label: "OpenCode", icon: "box", color: "#fb923c" };
  if (host === "codex") return { label: "Codex", icon: "terminal", color: "#34d399" };
  return { label: "pi", icon: "circle-dot", color: "#22d3ee" };
}

export const PALETTE = ["#34d399", "#818cf8", "#22d3ee", "#fbbf24", "#f472b6", "#a78bfa", "#fb923c", "#2dd4bf"];

/**
 * Provider marks name the routing service, never the model author. A neutral gateway has no
 * mark to reuse, so its tile is a monogram: an empty slug draws one. Vendor-branded routes
 * serve one vendor's models, so their mark is that vendor's.
 */
const PROVIDER_MARKS: Record<string, string> = {
  "amd-radeon-cloud-cn": "amd",
  "kimi-code": "kimi",
  "openai-codex": "openai",
  nvidia: "nvidia",
  "google-antigravity": "google",
  devin: "cognition",
  "github-copilot": "githubcopilot",
  "ollama-cloud": "ollama",
  cline: "cline",
  groq: "groq",
  poolside: "poolside",
  cerebras: "cerebras",
};

export interface ProviderMeta {
  /** Mark slug; empty when the provider gets a monogram tile. */
  slug: string;
}

export function providerMeta(provider: string): ProviderMeta {
  return { slug: PROVIDER_MARKS[provider] ?? "" };
}

/** Deterministic tint for a monogram tile: variety in a table, no claim about a brand. */
export function providerColor(provider: string): string {
  let h = 0;
  for (let i = 0; i < provider.length; i++) h = (h * 31 + provider.charCodeAt(i)) % 9973;
  return PALETTE[h % PALETTE.length];
}

// Zone indicators: coarse by design; captions say est. where modeled.
export type Zone = [glyph: string, label: string, cls: string];

export function co2Zone(g: number): Zone {
  if (!(g > 0)) return ["minus", "no data", ""];
  if (g <= 50) return ["sprout", "light", "good"];
  if (g <= 500) return ["face-slightly-smiling", "moderate", "good"];
  if (g <= 2000) return ["face-neutral", "heavy", "warn"];
  return ["flame", "very high", "bad"];
}

export function levZone(x: number): Zone {
  if (!(x > 0)) return ["minus", "no savings yet", ""];
  if (x >= 3) return ["rocket", "high leverage", "good"];
  if (x >= 1) return ["face-slightly-smiling", "solid", "good"];
  return ["face-neutral", "light", "warn"];
}

export function shareZone(p: number): Zone {
  if (!(p > 0)) return ["minus", "uncached", ""];
  if (p >= 80) return ["rocket", "high", "good"];
  if (p >= 50) return ["face-slightly-smiling", "good", "good"];
  return ["face-neutral", "low", "warn"];
}

export type RunStatus = "completed" | "aborted" | "error";

const STATUS_RANK: Record<string, number> = { error: 0, aborted: 1, completed: 2 };

export function statusRank(st: string): number {
  return STATUS_RANK[st] ?? 2;
}

export function statusLabel(r: { st: string; code?: number }): string {
  const label = r.st === "error" ? "error" + (r.code ? " " + r.code : "") : r.st === "aborted" ? "aborted" : "completed";
  return label[0].toUpperCase() + label.slice(1);
}

export function statusColor(st: string): string {
  return st === "error" ? "#f87171" : st === "aborted" ? "#fbbf24" : "var(--accent)";
}

// A recorded charge > 0 wins; an exact 0 means free, so fall back to modeled.
export function costIsMeasured(r: { usd?: number }): boolean {
  return typeof r.usd === "number" && r.usd > 0;
}

export function displayCost(r: { usd?: number; est: number }): number {
  return costIsMeasured(r) ? (r.usd as number) : r.est || 0;
}

// Absolute local stamp for the When column: "Sep 18, 11:14:08 PM".
export function whenStamp(ts: number): string {
  const d = new Date(ts);
  return (
    d.toLocaleString("en-US", { month: "short", day: "numeric" }) +
    ", " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })
  );
}

/** The clock alone, for the drawer's timing tile where a full date would clip. */
export function whenClock(ts: number): string {
  return new Date(ts).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

/** The minute stamp for a stat tile, where the full stamp would clip. */
export function whenShort(ts: number): string {
  return new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Snapshots span months, so the year has to be visible; whenStamp drops it.
export function fmtSnapshot(ts: number): string {
  const d = new Date(ts);
  return (
    d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  );
}

export function stampLocal(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Throughput uses output tokens streamed during the window.
export function fmtDur(ms: number | undefined): string {
  if (ms === undefined) return "–";
  const s = ms / 1000;
  return (s < 10 ? s.toFixed(1) : Math.round(s)) + "s";
}

export function speedText(r: { o: number; d?: number }): string {
  if (r.d === undefined) return "–";
  const tps = r.d > 0 ? r.o / (r.d / 1000) : 0;
  return fmtDur(r.d) + " ⚡" + (tps < 10 ? tps.toFixed(1) : Math.round(tps)) + "/s";
}

export function dayKey(d: Date): string {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

export function dateHead(key: string): string {
  const dt = new Date(key + "T12:00:00");
  return isNaN(+dt) ? key : dt.toLocaleString("en-US", { month: "short", day: "numeric" }).toUpperCase();
}

export function mondayKey(d: Date): string {
  const m = new Date(d);
  m.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  m.setHours(0, 0, 0, 0);
  return dayKey(m);
}

export function relAge(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}

// Seconds precision for the Models "Last run" column.
export function relAgePrecise(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m ago`;
  return `${Math.floor(s / 86400)}d ${String(Math.floor((s % 86400) / 3600)).padStart(2, "0")}h ago`;
}

// ---------------------------------------------------------------- omp-stats helpers

/** A rate as a percentage, one decimal: 0.9383 reads as 93.8%. */
export function pct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`;
}

/**
 * A bucket label. Day buckets read in UTC, matching the reference dashboards, so two machines
 * never disagree about which day a request landed in.
 */
export function tsLabel(ts: number, bucketMs: number): string {
  const d = new Date(ts);
  if (bucketMs <= 3_600_000) {
    return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The long form for a chart tooltip: a 5 minute bucket needs its hour, a day bucket its year. */
export function tsFull(ts: number, bucketMs: number): string {
  const d = new Date(ts);
  if (bucketMs <= 3_600_000) {
    return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" })} UTC`;
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** The hour axis on the Providers page reads in local time, matching the reference. */
export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** Middle value, ignoring nulls. Used where the mean hides the shape: latency. */
export function median(values: Array<number | null | undefined>): number {
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (nums.length === 0) return 0;
  const mid = nums.length >> 1;
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

/** Per-second throughput from an output-token count and a duration. */
export function tokensPerSecond(outputTokens: number, ms: number | null): number {
  return ms && ms > 0 ? outputTokens / (ms / 1000) : 0;
}

/** Agent type ids read as words. */
export function agentTypeLabel(agentType: string): string {
  if (agentType === "main") return "Main agent";
  if (agentType === "subagent") return "Subagents";
  if (agentType === "advisor") return "Advisor";
  return agentType || "Unknown";
}

/** omp records four stop reasons; only `error` is a failure, and `aborted` still ran. */
export function runStatusOf(stopReason: string): RunStatus {
  if (stopReason === "error") return "error";
  if (stopReason === "aborted") return "aborted";
  return "completed";
}

/** A project folder is the session's working directory, slugged. */
export function projectLabel(folder: string): string {
  return folder || "(none)";
}

