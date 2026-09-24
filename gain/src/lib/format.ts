// Ported from dashboard/core.js and dashboard/charts.js.
// Pure formatting, currency, vendor, and zone helpers. Same rules, same
// numbers: magnitude-aware money decimals, static FX snapshot with live
// frankfurter refresh, folded-key display names, provider registry.

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

export function fmtMs(ms: number): string {
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

// Magnitude-aware decimals. Model prices keep falling, so a flat 2dp rounds
// real spend down to "$0.00"; small amounts keep enough digits to stay
// readable (0.000187, not 0). Larger amounts use the currency's own scale.
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

// Display form for folded keys: namespace stays lowercase, model segments
// title-case with version dots kept (`deepseek-v4.1-flash` →
// `Deepseek-V4.1-Flash`). Keys arrive folded, so this prettifies only.
export function displayModel(m: string): string {
  const bare = String(m).replace(/(?::free|-free)$/i, "");
  function cap(s: string): string {
    const low = s.toLowerCase();
    if (low === "openai") return "OpenAI";
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
  const slash = bare.indexOf("/");
  if (slash >= 0) return bare.slice(0, slash).toLowerCase() + "/" + words(bare.slice(slash + 1));
  return words(bare);
}

export function shortName(m: string): string {
  const d = displayModel(m);
  return d.length > 22 ? d.slice(0, 21) + "..." : d;
}

export interface Vendor {
  name: string;
  slug: string;
  color: string;
}

const PROVIDERS: Array<[RegExp, string, string, string]> = [
  [/openai|codex|gpt-|o1/i, "OpenAI", "openai", "#fff"],
  [/muse/i, "Meta", "meta", "#0082fb"],
  [/deepseek/i, "DeepSeek", "deepseek", "#4d6bfe"],
  [/qwen|qwq/i, "Qwen", "qwen", "#6950EF"],
  [/glm|z-ai|zhipu/i, "Z.ai", "zdotai", "#2D2D2D"],
  [/mimo/i, "Xiaomi", "xiaomi", "#ff6900"],
  [/kimi|moonshot/i, "Moonshot", "kimi", "#a855f7"],
  [/minimax/i, "MiniMax", "minimax", "#e11d48"],
  [/nemotron|nvidia/i, "NVIDIA", "nvidia", "#76b900"],
  [/mistral/i, "Mistral", "mistralai", "#ff7000"],
  [/claude|anthropic/i, "Anthropic", "anthropic", "#d97757"],
  [/gemini|google|gemma/i, "Google", "google", "#4285F4"],
];

export function vendorOf(model: string): Vendor {
  for (const [re, name, slug, color] of PROVIDERS) {
    if (re.test(model)) return { name, slug, color };
  }
  return { name: "Other", slug: "", color: "#71717a" };
}

export const PALETTE = ["#34d399", "#818cf8", "#22d3ee", "#fbbf24", "#f472b6", "#a78bfa", "#fb923c", "#2dd4bf"];

// Zone indicators: coarse by design; captions say est. where modeled.
export type Zone = [glyph: string, label: string, cls: string];

export function co2Zone(g: number): Zone {
  if (!(g > 0)) return ["minus", "no data", ""];
  if (g <= 50) return ["sprout", "light", "good"];
  if (g <= 500) return ["smile", "moderate", "good"];
  if (g <= 2000) return ["meh", "heavy", "warn"];
  return ["flame", "very high", "bad"];
}

export function levZone(x: number): Zone {
  if (!(x > 0)) return ["minus", "no savings yet", ""];
  if (x >= 3) return ["rocket", "high leverage", "good"];
  if (x >= 1) return ["smile", "solid", "good"];
  return ["meh", "light", "warn"];
}

export function shareZone(p: number): Zone {
  if (!(p > 0)) return ["minus", "uncached", ""];
  if (p >= 80) return ["rocket", "high", "good"];
  if (p >= 50) return ["smile", "good", "good"];
  return ["meh", "low", "warn"];
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

// Cost precedence. A recorded charge > 0 is authoritative and shown bare.
// A recording of exactly 0 usually means a free/local provider and would
// blank the column, so those fall back to the modeled figure carrying the
// dashboard's usual "~" estimate marker.
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

export function stampLocal(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// Per-request generation time + output throughput from the message-level
// `duration` (ms). Missing → '–'. Throughput uses output tokens since that
// is what streams to the user during the measured window.
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
