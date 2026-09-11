// extensions/shared/carbon.ts — CO2/energy footprints, EcoLogits-style.
//
// Port of the EcoLogits v0.8.2 LLM impact model (genai-impact/ecologits,
// MPL-2.0 — see ECO_NOTICE.md), following the same served-estimate approach
// as honey-for-devs' hooks/eco.js: the faithful single-stream (batch-1)
// ceiling divided by serving_concurrency for continuous-batching amortization.
//
// Model params come from EcoLogits' registry where it covers the model;
// otherwise a documented class borrow (never a silent guess — every borrow
// carries its source). Unknown ids fall to the gpt-4o default. Everything
// rendered from here must carry ~est. and never merge with measured figures.

export interface ModelCarbon {
  activeB: number;
  totalB: number;
  provider: string;
  source: 'registry' | 'borrowed' | 'default';
}

// EcoLogits 0.8.2 constants — kWh, kgCO2eq, seconds, GB.
const Q_BITS = 4;
const E_ALPHA = 8.91e-8;
const E_BETA = 1.43e-6;
const L_ALPHA = 8.02e-4;
const L_BETA = 2.23e-2;
const GPU_MEM = 80;
const GPU_EMB_GWP = 143;
const SRV_GPUS = 8;
const SRV_POWER = 1;
const SRV_EMB_GWP = 3000;
const LIFETIME = 5 * 365 * 24 * 3600;
const PUE = 1.2;

// Per-provider grid intensity, gCO2eq/kWh (location-based research values).
const GRIDS: Record<string, number> = {
  anthropic: 500,
  openai: 400,
  google: 330,
  default: 450,
};

// Serving amortization: single-stream ceiling ÷ concurrency ≈ served impact.
export const SERVING_CONCURRENCY = 32;

interface RegistryEntry {
  match?: string;
  exact?: string;
  active: number;
  total: number;
  provider: string;
  source: 'registry' | 'borrowed';
}

// Registry values verbatim from EcoLogits' model_repository; borrows cite
// the public param disclosure they stand in for (MoE active/total).
const TABLE: RegistryEntry[] = [
  { match: 'opus', active: 625.0, total: 2000, provider: 'anthropic', source: 'registry' },
  { match: 'sonnet', active: 137.5, total: 440, provider: 'anthropic', source: 'registry' },
  { match: 'haiku', active: 18.0, total: 18.0, provider: 'anthropic', source: 'registry' },
  { match: 'gpt-5', active: 93.75, total: 300, provider: 'openai', source: 'registry' },
  { match: 'gpt', active: 137.5, total: 440, provider: 'openai', source: 'registry' },
  { match: 'gemini', active: 137.5, total: 440, provider: 'google', source: 'registry' },
  { match: 'deepseek', active: 37, total: 671, provider: 'default', source: 'borrowed' },
  { match: 'qwen', active: 22, total: 235, provider: 'default', source: 'borrowed' },
  { match: 'glm', active: 37, total: 671, provider: 'default', source: 'borrowed' },
  { match: 'kimi', active: 32, total: 1000, provider: 'default', source: 'borrowed' },
  { match: 'muse', active: 70, total: 70, provider: 'default', source: 'borrowed' },
  { match: 'flash', active: 18.0, total: 18.0, provider: 'default', source: 'borrowed' },
];

const DEFAULT_ENTRY = { active: 137.5, total: 440, provider: 'openai' };

export function carbonParamsFor(model: string): ModelCarbon {
  const name = model.toLowerCase();
  for (const row of TABLE) {
    if (row.match && name.includes(row.match)) {
      return { activeB: row.active, totalB: row.total, provider: row.provider, source: row.source };
    }
  }
  return { activeB: DEFAULT_ENTRY.active, totalB: DEFAULT_ENTRY.total, provider: DEFAULT_ENTRY.provider, source: 'default' };
}

export interface Footprint {
  energyWh: number;
  gco2: number;
  gco2Ceiling: number;
  concurrency: number;
  provider: string;
  paramSource: 'registry' | 'borrowed' | 'default';
}

function impacts(activeB: number, totalB: number, outTokens: number, gridKg: number): { energyKwh: number; gco2: number } {
  const gpuEnergy = outTokens * (E_ALPHA * activeB + E_BETA);
  const latency = outTokens * (L_ALPHA * activeB + L_BETA);
  const gpuCount = Math.ceil(((1.2 * totalB * Q_BITS) / 8 / GPU_MEM));
  const serverEnergy = (latency / 3600) * SRV_POWER * (gpuCount / SRV_GPUS);
  const energyKwh = PUE * (serverEnergy + gpuCount * gpuEnergy);
  const embGwp = (latency / LIFETIME) * ((gpuCount / SRV_GPUS) * SRV_EMB_GWP + gpuCount * GPU_EMB_GWP);
  return { energyKwh, gco2: (energyKwh * gridKg + embGwp) * 1000 };
}

export function footprintFor(model: string, outputTokens: number): Footprint {
  const p = carbonParamsFor(model);
  const gridKg = (GRIDS[p.provider] ?? GRIDS.default) / 1000;
  const ceiling = impacts(p.activeB, p.totalB, Math.max(0, Math.floor(outputTokens)), gridKg);
  const b = SERVING_CONCURRENCY > 0 ? SERVING_CONCURRENCY : 1;
  return {
    energyWh: (ceiling.energyKwh / b) * 1000,
    gco2: ceiling.gco2 / b,
    gco2Ceiling: ceiling.gco2,
    concurrency: b,
    provider: p.provider,
    paramSource: p.source,
  };
}

export function co2GramsFor(model: string, outputTokens: number): number {
  return footprintFor(model, outputTokens).gco2;
}

export function energyWhFor(model: string, outputTokens: number): number {
  return footprintFor(model, outputTokens).energyWh;
}
