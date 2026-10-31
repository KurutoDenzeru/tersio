// EcoLogits v0.11.3 port; always render as ~est, never merged with measured.

export interface ModelCarbon {
  activeB: number;
  totalB: number;
  provider: string;
  source: 'registry' | 'borrowed' | 'default';
}

// EcoLogits 0.11.3 constants — kWh, kgCO2eq, seconds, GB.
const E_ALPHA = 1.1665273170451914e-06;
const E_BETA = -0.011205921025579175;
const E_GAMMA = 4.052928146734005e-05;
const L_ALPHA = 0.0006785088094353663;
const L_BETA = 0.0003119310311688259;
const L_GAMMA = 0.019473717579473387;
const Q_BITS = 16;
const GPU_MEM = 80;
const GPU_EMB_GWP = 273;
const SRV_GPUS = 8;
const SRV_POWER = 1.2;
const SRV_EMB_GWP = 5700;
const LIFETIME = 3 * 365 * 24 * 3600;
const PUE = 1.2;

// Per-provider grid intensity, gCO2eq/kWh (location-based research values).
const GRIDS: Record<string, number> = {
  anthropic: 500,
  openai: 400,
  google: 330,
  default: 450,
};

// Serving amortization: requests served concurrently by one deployment.
export const SERVING_CONCURRENCY = 32;

/** EcoLogits release this port tracks, so a UI can name it instead of guessing. */
export const ECOLOGITS_VERSION = '0.11.3';

interface RegistryEntry {
  match?: string;
  exact?: string;
  active: number;
  total: number;
  provider: string;
  source: 'registry' | 'borrowed';
}

// From EcoLogits' model data (min/max active ranges fold to their midpoint); borrowed entries cite the param disclosure they replace (MoE active/total), since EcoLogits does not list them.
const TABLE: RegistryEntry[] = [
  { match: 'opus', active: 133.5, total: 670, provider: 'anthropic', source: 'registry' },
  { match: 'sonnet-5', active: 58.5, total: 293, provider: 'anthropic', source: 'registry' },
  { match: 'sonnet', active: 88, total: 440, provider: 'anthropic', source: 'registry' },
  { match: 'haiku', active: 22.5, total: 22.5, provider: 'anthropic', source: 'registry' },
  { match: 'gpt-5-pro', active: 720, total: 3600, provider: 'openai', source: 'registry' },
  { match: 'gpt-5.2', active: 84, total: 420, provider: 'openai', source: 'registry' },
  { match: 'gpt-5', active: 60, total: 300, provider: 'openai', source: 'registry' },
  { match: 'gpt-4o', active: 88, total: 440, provider: 'openai', source: 'registry' },
  { match: 'gpt-4', active: 352, total: 1760, provider: 'openai', source: 'registry' },
  { match: 'gpt', active: 88, total: 440, provider: 'openai', source: 'registry' },
  { match: 'gemini-3.1-pro', active: 240, total: 1200, provider: 'google', source: 'registry' },
  { match: 'gemini-3-pro', active: 240, total: 1200, provider: 'google', source: 'registry' },
  { match: 'gemini-3.5', active: 165, total: 900, provider: 'google', source: 'registry' },
  { match: 'gemini-3', active: 137.5, total: 750, provider: 'google', source: 'registry' },
  { match: 'gemini-pro', active: 400, total: 2000, provider: 'google', source: 'registry' },
  { match: 'flash-lite', active: 18, total: 18, provider: 'google', source: 'registry' },
  { match: 'gemini', active: 88, total: 440, provider: 'google', source: 'registry' },
  { match: 'deepseek', active: 37, total: 671, provider: 'default', source: 'borrowed' },
  { match: 'qwen', active: 22, total: 235, provider: 'default', source: 'borrowed' },
  { match: 'glm', active: 37, total: 671, provider: 'default', source: 'borrowed' },
  { match: 'kimi', active: 32, total: 1000, provider: 'default', source: 'borrowed' },
  { match: 'muse', active: 70, total: 70, provider: 'default', source: 'borrowed' },
  { match: 'flash', active: 18.0, total: 18.0, provider: 'default', source: 'borrowed' },
];

const DEFAULT_ENTRY = { active: 88, total: 440, provider: 'openai' };

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

function impacts(activeB: number, totalB: number, outTokens: number, batch: number, gridKg: number): { energyKwh: number; gco2: number } {
  // Per-token GPU energy follows EcoLogits' batch-dependent regression.
  const gpuEnergy = outTokens * ((E_ALPHA * Math.exp(E_BETA * batch) * activeB + E_GAMMA) / 1000);
  const latency = outTokens * (L_ALPHA * activeB + L_BETA * batch + L_GAMMA);
  // Serving a bigger model needs more GPUs, rounded up to the next power of two.
  const gpuCount = 2 ** Math.ceil(Math.log2(Math.ceil((1.2 * totalB * Q_BITS) / 8 / GPU_MEM)));
  const serverEnergy = (latency / 3600) * SRV_POWER * (gpuCount / SRV_GPUS) * (1 / batch);
  const energyKwh = PUE * (serverEnergy + gpuCount * gpuEnergy);
  const embodied = (latency * ((gpuCount / SRV_GPUS) * SRV_EMB_GWP + gpuCount * GPU_EMB_GWP)) / (LIFETIME * batch);
  return { energyKwh, gco2: (energyKwh * gridKg + embodied) * 1000 };
}

export function footprintFor(model: string, outputTokens: number): Footprint {
  const p = carbonParamsFor(model);
  const gridKg = (GRIDS[p.provider] ?? GRIDS.default) / 1000;
  const tokens = Math.max(0, Math.floor(outputTokens));
  // One request served alongside the concurrency, and the single-stream ceiling it cannot exceed.
  const served = impacts(p.activeB, p.totalB, tokens, SERVING_CONCURRENCY, gridKg);
  const ceiling = impacts(p.activeB, p.totalB, tokens, 1, gridKg);
  return {
    energyWh: served.energyKwh * 1000,
    gco2: served.gco2,
    gco2Ceiling: ceiling.gco2,
    concurrency: SERVING_CONCURRENCY,
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