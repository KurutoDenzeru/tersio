// Throwaway: the current omp catalog's real rates for the fifteen models in the screenshot.
import { readFileSync } from "node:fs";

const root = process.env.HOME + "/.bun/install/global/node_modules/@oh-my-pi/pi-catalog/src";
const catalog: Record<string, Record<string, { cost?: unknown; pricingStatus?: unknown }>> = JSON.parse(
  readFileSync(root + "/models.json", "utf8"),
);

const wanted = [
  "space-bunny",
  "muse-spark-1.3-contributor",
  "glm-5.3-flash",
  "qwen38-flash-next",
  "muse-spark-1.2-contributor",
  "qwen3.8-27b",
  "m3",
  "ox-alpha",
  "deepseek-v4-flash",
  "ling-3.0-flash-sante",
  "qwen3.6-35b-a3b-fp8",
  "mimo-v2.6-flash",
  "deepseek-v4.1-flash",
  "step-5-preview",
  "ling-3.1-flash",
  "longcat-2.5-preview",
];

const hits = new Map<string, Array<{ key: string; cost: unknown; status: unknown }>>();
for (const [provider, models] of Object.entries(catalog)) {
  if (!models || typeof models !== "object") continue;
  for (const [id, row] of Object.entries(models)) {
    const bare = id.toLowerCase().split("/").pop()!;
    if (!wanted.includes(bare)) continue;
    const list = hits.get(bare) ?? [];
    list.push({ key: provider + "/" + id, cost: row.cost, status: row.pricingStatus });
    hits.set(bare, list);
  }
}

for (const w of wanted) {
  const list = hits.get(w) ?? [];
  console.log("\n" + w.toUpperCase() + (list.length === 0 ? "  -- NOT IN CATALOG --" : "  -- " + list.length + " rows --"));
  for (const h of list) {
    const c = h.cost as { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } | undefined;
    const zero = c && c.input === 0 && c.output === 0 && c.cacheRead === 0 && c.cacheWrite === 0;
    console.log("   " + h.key.padEnd(50) + (zero ? "FREE ($0)" : "in=" + c?.input + " out=" + c?.output) + " status=" + JSON.stringify(h.status));
  }
}
