// cli/currency.ts — USD-base currency helpers on offline snapshot rates. Same 10 currencies as the dashboard, which prefers live frankfurter figures.

import { existsSync, readFileSync } from 'node:fs';
import { tersioSettingsFile } from '../extensions/shared/plugin-settings.ts';
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

// Stored default; USD when missing, corrupt, or an unknown code.
function readStoredCurrency(): CurrencyCode {
  const file = tersioSettingsFile();
  if (!existsSync(file)) return DEFAULT_CURRENCY;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return DEFAULT_CURRENCY;
    const raw = (parsed as { currency?: unknown }).currency;
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

// Exported so a test can hold it against the Dashboard's copy of the same table.
export const FX_SNAPSHOT_RATES: Record<CurrencyCode, number> = {
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
  convertUsd, formatCurrency, isCurrencyCode, parseCurrencyFlag, readStoredCurrency,
};

export type { CurrencyCode };
