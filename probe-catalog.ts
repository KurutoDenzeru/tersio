// Throwaway: read the real rate cards out of the pi-catalog omp already ships.
import { readFileSync } from "node:fs";

const root = process.env.HOME + "/.bun/install/global/node_modules/@oh-my-pi/pi-catalog/src";
const catalog: Record<string, Record<string, { cost?: unknown; name?: unknown; pricingStatus?: unknown }>> = JSON.parse(
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

let providers = 0;
let rows = 0;
const hits = new Map<string, Array<{ provider: string; id: string; cost: unknown; status: unknown }>>();
for (const [provider, models] of Object.entries(catalog)) {
  if (typeof models !== "object" || models === null) continue;
  providers += 1;
  for (const [id, row] of Object.entries(models)) {
    rows += 1;
    const bare = id.toLowerCase().split("/").pop()!;
    if (wanted.includes(bare)) {
      const list = hits.get(bare) ?? [];
      list.push({ provider, id, cost: row.cost, status: row.pricingStatus });
      hits.set(bare, list);
    }
  }
}
console.log("providers:", providers, "model rows:", rows, "\n");
for (const w of wanted) {
  const list = hits.get(w) ?? [];
  console.log(w.padEnd(26) + (list.length === 0 ? "  — NOT IN CATALOG —" : "  " + list.length + " row(s)"));
  for (const h of list.slice(0, 4)) {
    const c = h.cost as { input?: number; output?: number } | undefined;
    console.log(
      "    " + (h.provider + "/" + h.id).padEnd(52) + " in=" + String(c?.input ?? "?") + " out=" + String(c?.output ?? "?") + " status=" + JSON.stringify(h.status),
    );
  }
}
