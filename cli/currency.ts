// cli/currency.ts — display-currency helpers (USD-base, offline snapshot rates).
// Same 10 currencies, symbols, and snapshot rates as the gain dashboard's
// converter (dashboard/app.js); the dashboard replaces rates with live
// frankfurter figures when reachable, the CLI always uses the snapshot.

import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CURRENCY_CODES = [
  'USD',
  'PHP',
  'EUR',
  'GBP',
  'JPY',
  'KRW',
  'SGD',
  'AUD',
  'CAD',
  'INR',
] as const;

type CurrencyCode = (typeof CURRENCY_CODES)[number];

const DEFAULT_CURRENCY: CurrencyCode = 'USD';

function isCurrencyCode(value: string): value is CurrencyCode {
  return (CURRENCY_CODES as readonly string[]).includes(value);
}

// --currency flag parsing: undefined when absent, exits on invalid input.
function parseCurrencyFlag(raw: string | undefined): CurrencyCode | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim().toUpperCase();
  if (!isCurrencyCode(v)) {
    console.error(`[fail] Invalid --currency: ${raw}. Valid: ${CURRENCY_CODES.join(', ')}`);
    process.exit(1);
  }
  return v;
}

// Stored default from the omp plugin lock file (written by tersio settings);
// USD when missing, corrupt, or holding an unknown code. Sync so flag
// parsing in cli/common.ts can fall back to it at startup.
function readStoredCurrency(): CurrencyCode {
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const lock = path.join(home, '.omp', 'plugins', 'omp-plugins.lock.json');
  if (!existsSync(lock)) return DEFAULT_CURRENCY;
  try {
    const parsed: unknown = JSON.parse(readFileSync(lock, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !('settings' in parsed)) return DEFAULT_CURRENCY;
    const entry = (parsed as { settings?: Record<string, unknown> }).settings?.['@krtclcdy/tersio'];
    if (!entry || typeof entry !== 'object') return DEFAULT_CURRENCY;
    const raw = (entry as { currency?: unknown }).currency;
    return typeof raw === 'string' && isCurrencyCode(raw.trim().toUpperCase())
      ? (raw.trim().toUpperCase() as CurrencyCode)
      : DEFAULT_CURRENCY;
  } catch {
    return DEFAULT_CURRENCY;
  }
}

const CURRENCY_META: Record<CurrencyCode, { symbol: string; decimals: number }> = {
  USD: { symbol: '$', decimals: 2 },
  PHP: { symbol: '₱', decimals: 2 },
  EUR: { symbol: '€', decimals: 2 },
  GBP: { symbol: '£', decimals: 2 },
  JPY: { symbol: '¥', decimals: 0 },
  KRW: { symbol: '₩', decimals: 0 },
  SGD: { symbol: 'S$', decimals: 2 },
  AUD: { symbol: 'A$', decimals: 2 },
  CAD: { symbol: 'C$', decimals: 2 },
  INR: { symbol: '₹', decimals: 2 },
};

const FX_SNAPSHOT_RATES: Record<CurrencyCode, number> = {
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

function decimalsFor(amount: number, base: number): number {
  const a = Math.abs(amount);
  if (a >= 0.1 || a === 0) return base;
  if (a >= 0.001) return Math.max(base, 4);
  if (a >= 0.00001) return Math.max(base, 6);
  return Math.max(base, 8);
}

function convertUsd(usd: number, currency: CurrencyCode): number {
  return usd * FX_SNAPSHOT_RATES[currency];
}

function formatCurrency(usd: number, currency: CurrencyCode): string {
  const meta = CURRENCY_META[currency];
  const amount = convertUsd(usd, currency);
  const d = decimalsFor(amount, meta.decimals);
  return meta.symbol + amount.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export {
  CURRENCY_CODES, DEFAULT_CURRENCY,
  convertUsd, formatCurrency, isCurrencyCode, parseCurrencyFlag, readStoredCurrency, CurrencyCode,
};
