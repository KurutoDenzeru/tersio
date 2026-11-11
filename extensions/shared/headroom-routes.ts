// The endpoints Tersio writes itself, for every agent it can route. Only the active provider's
// endpoint changes, so a later model edit stays intact and the off switch puts the old URL back.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { headroomProxyUpstream, headroomProxyUrl, opencodeConfigFiles, proxyApiPath } from './headroom-proxy.ts';
import {
  headroomProxyPort,
  readOmpGateway,
  restoreOmpGateway,
  routeOmpDefaultModel,
  routeOmpGateway,
} from './headroom-proxy.ts';
import { ensureAgentProviderRoute } from './headroom-agent.ts';
import { codexConfigFile } from './codex-state.ts';
import {
  describeHeadroomRoute,
  dshDefaultRoute,
  dshProfileFiles,
  dshProviders,
  jsonBaseUrl,
  jsonModelEntry,
  readHeadroomRoute,
  sameProxyEndpoint,
  stripJsonComments,
} from './headroom-routing.ts';
import { splicePath } from './jsonc-edit.ts';
import type { HeadroomRoute } from './headroom-routing.ts';
import { HOST_CAPS, hostCap } from './host-caps.ts';
import { patchState, readState } from './state.ts';
import { homeDir, piAgentDir, pigAgentDir, resolveHeadroomBinary, tersioHome } from './utils.ts';
import type { HeadroomRouteRecord } from './state.ts';

export type NativeRouteHost = 'pi' | 'pig' | 'dsh' | 'opencode';
export const NATIVE_ROUTE_HOSTS: ReadonlyArray<NativeRouteHost> = ['pi', 'pig', 'dsh', 'opencode'];

export interface NativeRouteResult {
  ok: boolean;
  detail: string;
}

const runHeadroom = promisify(execFile);
const CODEX_HEADROOM_BACKUP = 'headroom-codex.json';
// Codex refuses a user block with this ID; the built-in provider is routed through `openai_base_url`.
const CODEX_RESERVED_PROVIDERS = new Set(['openai']);

export interface CodexRootBackup {
  modelProvider: string | null;
  modelProviderPresent: boolean;
  openaiBaseUrl: string | null;
  openaiBaseUrlPresent: boolean;
  provider?: string | null;
  providerBaseUrl?: string | null;
  providerBaseUrlPresent?: boolean;
}

function codexConfigText(): string | null {
  try {
    return readFileSync(codexConfigFile(), 'utf8');
  } catch {
    return null;
  }
}

/** The two root keys Headroom's Codex init replaces; absence is distinct from an empty value. */
function codexRootValue(text: string, key: string): { value: string | null; present: boolean } {
  let present = false;
  let value: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) break;
    const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`));
    if (!match) continue;
    present = true;
    value = match[1]!
      .replace(/\s+#.*$/, '')
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return { value, present };
}

function codexSectionValue(text: string, section: string, key: string): { value: string | null; present: boolean } {
  let active = false;
  let present = false;
  let value: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) {
      if (active) break;
      active = trimmed === `[${section}]`;
      continue;
    }
    if (!active) continue;
    const match = trimmed.match(new RegExp(`^${key}\\s*=\\s*(.*)$`));
    if (!match) continue;
    present = true;
    value = match[1]!
      .replace(/\s+#.*$/, '')
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return { value, present };
}

function readCodexBackup(): CodexRootBackup | null {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(tersioHome(), CODEX_HEADROOM_BACKUP), 'utf8'),
    ) as Partial<CodexRootBackup>;
    return {
      modelProvider: typeof parsed.modelProvider === 'string' ? parsed.modelProvider : null,
      modelProviderPresent: parsed.modelProviderPresent === true,
      openaiBaseUrl: typeof parsed.openaiBaseUrl === 'string' ? parsed.openaiBaseUrl : null,
      openaiBaseUrlPresent: parsed.openaiBaseUrlPresent === true,
      provider: typeof parsed.provider === 'string' ? parsed.provider : null,
      providerBaseUrl: typeof parsed.providerBaseUrl === 'string' ? parsed.providerBaseUrl : null,
      providerBaseUrlPresent: parsed.providerBaseUrlPresent === true,
    };
  } catch {
    return null;
  }
}

function writeCodexBackup(backup: CodexRootBackup): void {
  try {
    const root = tersioHome();
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, CODEX_HEADROOM_BACKUP), `${JSON.stringify(backup, null, 2)}\n`, 'utf8');
  } catch {
    /* the route still works; the next unwrap falls back to Headroom's manifest */
  }
}

function removeCodexBackup(): void {
  try {
    const file = path.join(tersioHome(), CODEX_HEADROOM_BACKUP);
    if (existsSync(file)) {
      // This file is Tersio's own marker, not a host config.
      rmSync(file, { force: true });
    }
  } catch {
    /* a missing marker is already clean */
  }
}

/** Put the root provider keys back after Headroom's own unwrap removes its block. */
export function restoreCodexRoot(text: string, backup: CodexRootBackup): string {
  const lines = text.split(/\r?\n/);
  const firstSection = lines.findIndex((line) => /^\s*\[/.test(line));
  const end = firstSection < 0 ? lines.length : firstSection;
  const root = lines.slice(0, end).filter((line) => !/^\s*(model_provider|openai_base_url)\s*=/.test(line));
  const restored: string[] = [];
  if (backup.modelProviderPresent && backup.modelProvider !== null)
    restored.push(`model_provider = ${JSON.stringify(backup.modelProvider)}`);
  if (backup.openaiBaseUrlPresent && backup.openaiBaseUrl !== null)
    restored.push(`openai_base_url = ${JSON.stringify(backup.openaiBaseUrl)}`);
  return [...root, ...restored, ...lines.slice(end)].join(text.includes('\r\n') ? '\r\n' : '\n');
}

export function setTomlSectionValue(text: string, section: string, key: string, value: string): string {
  const lines = text.split(/\r?\n/);
  const header = `[${section}]`;
  const start = lines.findIndex((line) => line.trim() === header);
  const rendered = `${key} = ${JSON.stringify(value)}`;
  if (start < 0) return [...lines, '', header, rendered].join(text.includes('\r\n') ? '\r\n' : '\n');
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\[/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  const at = lines.findIndex((line, i) => i > start && i < end && new RegExp(`^\\s*${key}\\s*=`).test(line));
  if (at >= 0) lines[at] = rendered;
  else lines.splice(end, 0, rendered);
  return lines.join(text.includes('\r\n') ? '\r\n' : '\n');
}

/** Drop a section a writer created; Codex treats `model_providers.openai` as an invalid override. */
export function removeTomlSection(text: string, section: string): string {
  const lines = text.split(/\r?\n/);
  const header = `[${section}]`;
  const start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) return text;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\[/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  lines.splice(start, end - start);
  return lines.join(text.includes('\r\n') ? '\r\n' : '\n');
}

function routableCodexProvider(value: string | null | undefined): string | null {
  if (!value || value === 'headroom' || CODEX_RESERVED_PROVIDERS.has(value)) return null;
  return value;
}

export function inferCodexRootBackup(text: string): CodexRootBackup {
  const upstream = headroomProxyUpstream('openai');
  const modelProvider = codexRootValue(text, 'model_provider');
  // An absent provider is Codex's built-in OpenAI route, which only `openai_base_url` can move.
  const provider = routableCodexProvider(modelProvider.value);
  const providerBase = provider
    ? codexSectionValue(text, `model_providers.${provider}`, 'base_url')
    : { value: null, present: false };
  if (modelProvider.value === 'headroom') {
    return {
      modelProvider: null,
      modelProviderPresent: false,
      openaiBaseUrl: upstream && upstream !== headroomProxyUrl() ? upstream : null,
      openaiBaseUrlPresent: Boolean(upstream && upstream !== headroomProxyUrl()),
      provider: null,
      providerBaseUrl: null,
      providerBaseUrlPresent: false,
    };
  }
  const base = codexRootValue(text, 'openai_base_url');
  return {
    modelProvider: modelProvider.value,
    modelProviderPresent: modelProvider.present,
    openaiBaseUrl: base.value,
    openaiBaseUrlPresent: base.present,
    provider,
    providerBaseUrl: providerBase.value,
    providerBaseUrlPresent: providerBase.present,
  };
}

async function headroomCommand(args: string[]): Promise<{ ok: boolean; detail: string }> {
  const bin = resolveHeadroomBinary();
  if (!bin) return { ok: false, detail: 'headroom is not installed' };
  try {
    const result = await runHeadroom(bin, args, { timeout: 120_000, maxBuffer: 1024 * 1024 });
    return { ok: true, detail: result.stdout.trim() || result.stderr.trim() || `headroom ${args.join(' ')}` };
  } catch (e) {
    const error = e as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      detail: (error.stderr || error.stdout || error.message || `headroom ${args.join(' ')} failed`).trim(),
    };
  }
}

/** Headroom owns Codex's provider block and hooks, so its own init/unwrap commands write them. */
export async function routeCodexHeadroom(proxyUrl: string = headroomProxyUrl()): Promise<NativeRouteResult> {
  const before = codexConfigText();
  if (before !== null) {
    const inferred = inferCodexRootBackup(before);
    const held = readCodexBackup();
    writeCodexBackup(
      held
        ? {
            ...inferred,
            ...held,
            provider: routableCodexProvider(held.provider) ?? inferred.provider,
            providerBaseUrl: held.providerBaseUrl ?? inferred.providerBaseUrl,
            providerBaseUrlPresent: held.providerBaseUrlPresent === true || inferred.providerBaseUrlPresent === true,
            modelProviderPresent: held.modelProviderPresent === true || inferred.modelProviderPresent === true,
            openaiBaseUrlPresent: held.openaiBaseUrlPresent === true || inferred.openaiBaseUrlPresent === true,
          }
        : inferred,
    );
  }
  const installed = await headroomCommand(['init', '-g', '--port', String(headroomProxyPort()), 'codex']);
  if (!installed.ok) return installed;
  const backup = readCodexBackup();
  const after = codexConfigText();
  // Codex appends `/responses` to this URL, and the proxy only upgrades the `/v1` path to a
  // WebSocket. A root URL answers 403 on the upgrade before Codex falls back to HTTPS.
  const openaiBase = nativeProxyUrl('openai', proxyUrl);
  if (backup && after !== null) {
    let routed = removeTomlSection(after, 'model_providers.openai');
    routed = restoreCodexRoot(routed, { ...backup, openaiBaseUrl: openaiBase, openaiBaseUrlPresent: true });
    if (backup.provider && backup.provider !== 'headroom') {
      routed = setTomlSectionValue(routed, `model_providers.${backup.provider}`, 'base_url', openaiBase);
    }
    writeFileSync(codexConfigFile(), routed, 'utf8');
  }
  const route = readHeadroomRoute('codex', proxyUrl);
  return route.routed
    ? { ok: true, detail: `codex: ${describeHeadroomRoute(route)}` }
    : { ok: false, detail: `codex: ${describeHeadroomRoute(route)}` };
}

export async function unwrapCodexHeadroom(): Promise<NativeRouteResult> {
  const before = codexConfigText();
  const backup = readCodexBackup() ?? (before ? inferCodexRootBackup(before) : null);
  const result = await headroomCommand(['unwrap', 'codex']);
  if (result.ok && backup) {
    const text = codexConfigText();
    if (text !== null) {
      let restored = removeTomlSection(text, 'model_providers.openai');
      restored = restoreCodexRoot(restored, backup);
      if (
        backup.provider &&
        backup.provider !== 'headroom' &&
        backup.providerBaseUrlPresent &&
        backup.providerBaseUrl
      ) {
        restored = setTomlSectionValue(
          restored,
          `model_providers.${backup.provider}`,
          'base_url',
          backup.providerBaseUrl,
        );
      }
      writeFileSync(codexConfigFile(), restored, 'utf8');
    }
    removeCodexBackup();
  }
  return result;
}

/** Claude Code has a durable Headroom init: its own hooks and provider routing in settings.json. */
export async function routeClaudeHeadroom(proxyUrl: string = headroomProxyUrl()): Promise<NativeRouteResult> {
  const installed = await headroomCommand(['init', '-g', '--port', String(headroomProxyPort()), 'claude']);
  if (!installed.ok) return installed;
  const route = readHeadroomRoute('claude', proxyUrl);
  return route.routed
    ? { ok: true, detail: `claude: ${describeHeadroomRoute(route)}` }
    : { ok: false, detail: `claude: ${describeHeadroomRoute(route)}` };
}

/** Undo Headroom's Claude setup, but leave the proxy running: the caller stops it when no route is left. */
export async function unwrapClaudeHeadroom(): Promise<NativeRouteResult> {
  const result = await headroomCommand(['unwrap', 'claude', '--no-stop-proxy']);
  if (!result.ok) return result;
  const route = readHeadroomRoute('claude');
  return route.routed
    ? { ok: false, detail: `claude: ${describeHeadroomRoute(route)}` }
    : { ok: true, detail: 'claude: Headroom routing removed' };
}

export function isNativeRouteHost(host: string): host is NativeRouteHost {
  return (NATIVE_ROUTE_HOSTS as ReadonlyArray<string>).includes(host);
}

/** The URL the host's protocol needs: Anthropic clients use the root, OpenAI clients add `/v1`. */
export function nativeProxyUrl(api: string, proxyUrl: string = headroomProxyUrl()): string {
  const root = proxyUrl.replace(/\/+$/, '');
  return `${root}${proxyApiPath(api)}`;
}

/** The same upstream, path included: a proxy pointed at another provider must not take this route. */
function sameUpstream(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return left.origin === right.origin && left.pathname.replace(/\/+$/, '') === right.pathname.replace(/\/+$/, '');
  } catch {
    return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
  }
}

export function nativeRouteRecords(host: NativeRouteHost): HeadroomRouteRecord[] {
  return readState().headroomRoutes?.[host] ?? [];
}

export function hasNativeRoute(host: NativeRouteHost): boolean {
  return nativeRouteRecords(host).length > 0;
}

/**
 * True when a tool other than Tersio put the endpoint back. A model switcher that owns the provider
 * block rewrites it on every switch, so the recorded route disappears without the user asking.
 * Only the endpoint Tersio replaced counts: a newer edit of the user's own is left alone.
 */
export function routeDrifted(host: string, route: HeadroomRoute): boolean {
  if (!isNativeRouteHost(host) || !route.measured || route.routed || !route.baseUrl) return false;
  const current = route.baseUrl;
  return nativeRouteRecords(host).some((record) => sameProxyEndpoint(current, record.original));
}

function saveRecords(host: NativeRouteHost, records: HeadroomRouteRecord[]): void {
  const all = readState().headroomRoutes ?? {};
  if (records.length > 0) all[host] = records;
  else delete all[host];
  patchState({ headroomRoutes: all });
}

interface Target {
  file: string;
  provider: string;
  /** Set when the record owns one model's endpoint instead of the provider's. */
  model?: string;
  api: string;
  original: string;
  write: (url: string) => void;
  /** A provider block that records no upstream to compare: its endpoint is set by hand today. */
  skipUpstream?: boolean;
  /** The dotted key inside the provider block, when the endpoint is nested. */
  key?: string;
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The endpoint key a block actually uses, so a write keeps the host's own spelling. */
function endpointKey(record: Record<string, unknown>): string {
  return ['baseUrl', 'baseURL', 'base_url'].find((key) => typeof record[key] === 'string') ?? '';
}

/** The protocol, host, and port two endpoints share; a path may differ and still reach one service. */
function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** Write one endpoint into the provider block, or into the model entry that overrides it. */
function writeJsonEndpoint(file: string, provider: string, model: string | null, key: string, url: string): void {
  const fresh = readJson(file);
  if (!fresh) throw new Error(`${file} is not valid JSON`);
  const list =
    fresh.providers && typeof fresh.providers === 'object' ? (fresh.providers as Record<string, unknown>) : {};
  const block = list[provider];
  if (!block || typeof block !== 'object') throw new Error(`${provider} is not in ${file}`);
  const target = model
    ? jsonModelEntry(block as Record<string, unknown>, model, provider)
    : (block as Record<string, unknown>);
  if (!target) throw new Error(`${model} is not in ${file}`);
  target[key] = url;
  writeFileSync(file, `${JSON.stringify(fresh, null, 2)}\n`, 'utf8');
}

function piTargets(host: 'pi' | 'pig'): Target[] {
  const dir = host === 'pig' ? pigAgentDir() : piAgentDir();
  const settings = readJson(path.join(dir, 'settings.json'));
  const modelsFile = path.join(dir, 'models.json');
  const models = readJson(modelsFile);
  if (!settings || !models) return [];
  const model = typeof settings.defaultModel === 'string' ? settings.defaultModel : '';
  const named = typeof settings.defaultProvider === 'string' ? settings.defaultProvider : '';
  const provider = named || (model.includes('/') ? model.slice(0, model.indexOf('/')) : '');
  if (!provider) return [];
  const providers =
    models.providers && typeof models.providers === 'object' ? (models.providers as Record<string, unknown>) : {};
  const entry = providers[provider];
  const record = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
  if (!record) return [];
  const api = typeof record.api === 'string' ? record.api : '';
  const targets: Target[] = [];
  const providerKey = endpointKey(record);
  if (providerKey) {
    targets.push({
      file: modelsFile,
      provider,
      api,
      original: record[providerKey] as string,
      write: (url: string) => writeJsonEndpoint(modelsFile, provider, null, providerKey, url),
    });
  }
  // A model that names its own endpoint beats the provider's, so it is routed beside it.
  const modelEntry = model ? jsonModelEntry(record, model, provider) : null;
  const modelKey = modelEntry ? endpointKey(modelEntry) : '';
  const modelId = modelEntry && typeof modelEntry.id === 'string' ? modelEntry.id : '';
  if (modelId && modelKey) {
    targets.push({
      file: modelsFile,
      provider,
      model: modelId,
      api,
      original: modelEntry![modelKey] as string,
      write: (url: string) => writeJsonEndpoint(modelsFile, provider, modelId, modelKey, url),
    });
  }
  return targets;
}

/** The dsh files that hold the active provider, with the settings file first. */
function dshTargets(): Target[] {
  const root = path.join(homeDir(), '.dsh');
  const settingsFile = path.join(root, 'settings.yaml');
  const profiles = dshProfileFiles(root);
  const profile = profiles[0];
  if (!profile) return [];
  let provider = '';
  try {
    provider = dshDefaultRoute(readFileSync(profile, 'utf8')).provider;
  } catch {
    /* absent */
  }
  if (!provider) return [];
  const targets: Target[] = [];
  // The active profile only: writing the other one would route an app that is not running.
  for (const file of [settingsFile, profile]) {
    if (!existsSync(file)) continue;
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const block = dshProviders(text).find((entry) => entry.name === provider && entry.baseLine >= 0);
    if (!block || !block.baseUrl) continue;
    targets.push({
      file,
      provider,
      api: block.api,
      original: block.baseUrl,
      write: (url: string) => {
        const fresh = readFileSync(file, 'utf8');
        const freshBlock = dshProviders(fresh).find((entry) => entry.name === provider && entry.baseLine >= 0);
        if (!freshBlock) throw new Error(`${provider} is not in ${file}`);
        const lines = fresh.split(/\r?\n/);
        const line = lines[freshBlock.baseLine];
        if (line === undefined) throw new Error(`${file} changed while routing`);
        const indent = line.match(/^\s*/)?.[0] ?? '';
        const comment = line.match(/\s+#.*$/)?.[0] ?? '';
        lines[freshBlock.baseLine] = `${indent}baseURL: ${url}${comment}`;
        writeFileSync(file, lines.join(fresh.includes('\r\n') ? '\r\n' : '\n'), 'utf8');
      },
    });
  }
  return targets;
}

/** Where OpenCode keeps the active provider's endpoint: V2 `providers.<id>.settings`, V1 `provider.<id>`. */
function opencodeEndpoint(data: Record<string, unknown>, provider: string): { key: string; original: string } | null {
  const map =
    data.providers && typeof data.providers === 'object'
      ? 'providers'
      : data.provider && typeof data.provider === 'object'
        ? 'provider'
        : '';
  if (!map) return null;
  const providers = data[map] as Record<string, unknown>;
  const block = providers[provider];
  if (!block || typeof block !== 'object') return null;
  const record = block as Record<string, unknown>;
  const settings =
    record.settings && typeof record.settings === 'object' ? (record.settings as Record<string, unknown>) : {};
  const options =
    record.options && typeof record.options === 'object' ? (record.options as Record<string, unknown>) : {};
  // V2 first: `settings.baseURL`. Then V1's `api`, then the spellings an older config may carry.
  const candidates: Array<[string, unknown]> =
    map === 'providers'
      ? [['settings.baseURL', settings.baseURL]]
      : [
          ['options.baseURL', options.baseURL],
          ['options.baseUrl', options.baseUrl],
          ['options.base_url', options.base_url],
          ['baseURL', record.baseURL],
          ['baseUrl', record.baseUrl],
          ['base_url', record.base_url],
          ['api', record.api],
        ];
  for (const [key, value] of candidates) {
    if (typeof value === 'string' && value.trim() !== '') return { key: `${map}.${provider}.${key}`, original: value };
  }
  return null;
}

function readDotted(record: Record<string, unknown>, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (value, part) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined),
      record,
    );
}

function writeDotted(record: Record<string, unknown>, key: string, value: string): void {
  const parts = key.split('.');
  let cursor: Record<string, unknown> = record;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (!next || typeof next !== 'object') throw new Error(`${part} is not an object`);
    cursor = next as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]!] = value;
}

/** Write one OpenCode endpoint. A `.jsonc` file is edited in place, so its comments survive. */
function writeOpencodeEndpoint(file: string, key: string, url: string): void {
  if (file.toLowerCase().endsWith('.jsonc')) {
    const next = splicePath(readFileSync(file, 'utf8'), key.split('.'), url);
    if (next === null)
      throw new Error(`${key} is not in ${file}; add it by hand or run tersio install --host opencode`);
    writeFileSync(file, next, 'utf8');
    return;
  }
  const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  writeDotted(data, key, url);
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

/**
 * OpenCode's active provider: V2 keeps the endpoint under `providers.<id>.settings`, V1 under its own
 * options. A config with no endpoint to move is skipped rather than flattened to invent one.
 */
function opencodeTargets(): Target[] {
  for (const file of opencodeConfigFiles()) {
    if (!existsSync(file)) continue;
    let text: string;
    let data: Record<string, unknown>;
    try {
      text = readFileSync(file, 'utf8');
      data = JSON.parse(stripJsonComments(text)) as Record<string, unknown>;
    } catch {
      return [];
    }
    const model = typeof data.model === 'string' ? data.model : '';
    if (!model.includes('/')) return [];
    const provider = model.slice(0, model.indexOf('/'));
    const endpoint = opencodeEndpoint(data, provider);
    if (!endpoint) return [];
    return [
      {
        file,
        provider,
        key: endpoint.key,
        // OpenCode's block names a package, not an API dialect, so there is no upstream to compare.
        api: '',
        skipUpstream: true,
        original: endpoint.original,
        write: (url: string) => writeOpencodeEndpoint(file, endpoint.key, url),
      },
    ];
  }
  return [];
}

const TARGET_PLANNERS: Record<NativeRouteHost, () => Target[]> = {
  pi: () => piTargets('pi'),
  pig: () => piTargets('pig'),
  dsh: dshTargets,
  opencode: opencodeTargets,
};

/** Point the active provider at Headroom and keep the URL it replaced. */
export function installNativeRoute(host: NativeRouteHost, proxyUrl: string = headroomProxyUrl()): NativeRouteResult {
  // A provider change leaves the old record behind; put that endpoint back before recording a new one.
  if (nativeRouteRecords(host).length > 0) {
    const restored = removeNativeRoute(host);
    if (!restored.ok) return restored;
  }
  let targets: Target[];
  try {
    targets = TARGET_PLANNERS[host]();
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
  if (targets.length === 0) return { ok: false, detail: `no active provider endpoint found for ${host}` };
  // A route only makes sense when the proxy names the provider it replaces for this protocol.
  for (const target of targets) {
    if (target.model || target.skipUpstream) continue;
    const anthropic = /anthropic/i.test(target.api);
    // A host with no endpoint of its own still has a public default the proxy must name.
    const expected = target.original || (anthropic ? 'https://api.anthropic.com' : '');
    const upstream = headroomProxyUpstream(target.api);
    if (!upstream) {
      const flag = anthropic ? '--anthropic-api-url' : '--openai-api-url';
      return {
        ok: false,
        detail: `${host}: Headroom names no upstream for ${target.api || 'OpenAI'} traffic. Start it with ${flag} ${expected} first.`,
      };
    }
    if (expected && !sameUpstream(upstream, expected)) {
      // One proxy forwards to one upstream; moving it for this agent would strand the others.
      const others = headroomRoutedHosts(host);
      const already =
        others.length > 0
          ? ` Already routed through ${upstream}: ${others.join(', ')}; repointing the proxy would break ${others.length === 1 ? 'it' : 'them'}.`
          : '';
      return {
        ok: false,
        detail: `${host}: ${expected} is not Headroom's upstream (${upstream}).${already} Start Headroom with ${expected} first.`,
      };
    }
  }
  // A model's own endpoint may spell its path differently, so only the service has to match.
  for (const target of targets) {
    if (!target.model) continue;
    const provider = targets.find(
      (entry) => !entry.model && entry.file === target.file && entry.provider === target.provider,
    );
    const expected = provider ? provider.original : target.original;
    if (!sameOrigin(target.original, expected)) {
      return {
        ok: false,
        detail: `${host}: ${target.original} is a different service from ${expected}. Route ${target.model} by hand.`,
      };
    }
  }
  const records: HeadroomRouteRecord[] = [];
  const applied: Target[] = [];
  try {
    for (const target of targets) {
      const url = nativeProxyUrl(target.api, proxyUrl);
      if (sameProxyEndpoint(target.original, url)) continue;
      target.write(url);
      applied.push(target);
      records.push({
        file: target.file,
        provider: target.provider,
        model: target.model,
        original: target.original,
        written: url,
        ...(target.key ? { key: target.key } : {}),
      });
    }
  } catch (e) {
    for (const target of applied) {
      try {
        target.write(target.original);
      } catch {
        /* best effort */
      }
    }
    return { ok: false, detail: (e as Error).message };
  }
  if (records.length === 0) return { ok: true, detail: `${host} already reaches Headroom` };
  saveRecords(host, records);
  const check = readHeadroomRoute(host, proxyUrl);
  if (check.routed) {
    return {
      ok: true,
      detail: `${host}: ${records.length} endpoint${records.length === 1 ? '' : 's'} routed through Headroom`,
    };
  }
  const restored = removeNativeRoute(host);
  return {
    ok: false,
    detail: `${host} still bypasses Headroom after the write (${describeHeadroomRoute(check)})${restored.ok ? ', endpoints restored' : ''}`,
  };
}

/** The agents routed at the proxy right now; without one, nothing needs a proxy at all. */
export function headroomRoutedHosts(except?: string): string[] {
  return Object.keys(HOST_CAPS).filter((id) => id !== except && readHeadroomRoute(id).routed);
}

/** Point one agent at the proxy, through whichever writer that agent's config needs. */
export async function routeHostOn(host: string, proxyUrl: string = headroomProxyUrl()): Promise<NativeRouteResult> {
  const port = headroomProxyPort();
  if (host === 'codex') return routeCodexHeadroom(proxyUrl);
  if (host === 'claude') return routeClaudeHeadroom(proxyUrl);
  // A provider the host keeps in its own catalog needs a block before the endpoint can move.
  const ensured = ensureAgentProviderRoute(host, port);
  if (!ensured.ok) return { ok: false, detail: ensured.detail };
  if (isNativeRouteHost(host)) return installNativeRoute(host, proxyUrl);
  routeOmpDefaultModel(port);
  // omp's provider line may already point at another local gateway, so that line moves too.
  const gateway = hostCap(host)?.headroomGateway ? readOmpGateway(port) : null;
  if (gateway && !routeOmpGateway(gateway, port))
    return { ok: false, detail: `${host}: the gateway line could not be moved` };
  const route = readHeadroomRoute(host, proxyUrl);
  return route.routed
    ? { ok: true, detail: `${host}: ${describeHeadroomRoute(route)}` }
    : { ok: false, detail: describeHeadroomRoute(route) };
}

/** Put back every endpoint `routeHostOn` replaced, including the gateway line omp needs. */
export async function routeHostOff(host: string): Promise<NativeRouteResult> {
  if (host === 'codex') return unwrapCodexHeadroom();
  if (host === 'claude') return unwrapClaudeHeadroom();
  if (isNativeRouteHost(host)) return removeNativeRoute(host);
  if (hostCap(host)?.headroomGateway) {
    return restoreOmpGateway(headroomProxyPort())
      ? { ok: true, detail: `${host}: gateway endpoint restored` }
      : { ok: false, detail: `${host} has no Tersio route to put back` };
  }
  return { ok: false, detail: `${host} has no Tersio route to put back` };
}

/**
 * Put back a route a third-party writer replaced. A native host still has Tersio's record, so the
 * recorded endpoint proves the drift. A durable host's block belongs to headroom, so its own writer
 * restores it and no record is needed. Neither path touches the gateway that overwrote the route.
 */
export async function repairHeadroomRoute(
  host: string,
  proxyUrl: string = headroomProxyUrl(),
): Promise<NativeRouteResult> {
  const route = readHeadroomRoute(host, proxyUrl);
  if (!route.measured) return { ok: false, detail: describeHeadroomRoute(route) };
  if (route.routed) return { ok: true, detail: `${host} already reaches Headroom` };
  if (host === 'codex') return routeCodexHeadroom(proxyUrl);
  if (host === 'claude') return routeClaudeHeadroom(proxyUrl);
  if (isNativeRouteHost(host)) {
    if (!routeDrifted(host, route)) return { ok: false, detail: describeHeadroomRoute(route) };
    return installNativeRoute(host, proxyUrl);
  }
  // omp: the marker beside the gateway line still holds the endpoint Tersio replaced.
  if (hostCap(host)?.headroomGateway) {
    const port = headroomProxyPort();
    const gateway = readOmpGateway(port);
    if (!gateway) return { ok: false, detail: describeHeadroomRoute(route) };
    if (!routeOmpGateway(gateway, port)) return { ok: false, detail: `${host}: the gateway line could not be moved` };
    const repaired = readHeadroomRoute(host, proxyUrl);
    return repaired.routed
      ? { ok: true, detail: `${host}: ${describeHeadroomRoute(repaired)}` }
      : { ok: false, detail: describeHeadroomRoute(repaired) };
  }
  return { ok: false, detail: describeHeadroomRoute(route) };
}

/** Put back the endpoint Tersio replaced, leaving any newer edit alone. */
export function removeNativeRoute(host: NativeRouteHost): NativeRouteResult {
  const records = nativeRouteRecords(host);
  if (records.length === 0) return { ok: true, detail: `no Tersio route recorded for ${host}` };
  const failed: HeadroomRouteRecord[] = [];
  for (const record of records) {
    try {
      const text = readFileSync(record.file, 'utf8');
      if (host === 'dsh') {
        const block = dshProviders(text).find((entry) => entry.name === record.provider && entry.baseLine >= 0);
        if (!block) continue;
        if (!sameProxyEndpoint(block.baseUrl, record.written)) continue;
        const lines = text.split(/\r?\n/);
        const line = lines[block.baseLine];
        if (line === undefined) throw new Error(`${record.file} changed while unwrapping`);
        const indent = line.match(/^\s*/)?.[0] ?? '';
        const comment = line.match(/\s+#.*$/)?.[0] ?? '';
        lines[block.baseLine] = `${indent}baseURL: ${record.original}${comment}`;
        writeFileSync(record.file, lines.join(text.includes('\r\n') ? '\r\n' : '\n'), 'utf8');
      } else if (host === 'opencode') {
        if (!record.key) continue;
        const current = readDotted(JSON.parse(stripJsonComments(text)) as Record<string, unknown>, record.key);
        if (typeof current !== 'string' || !sameProxyEndpoint(current, record.written)) continue;
        writeOpencodeEndpoint(record.file, record.key, record.original);
      } else {
        const data = JSON.parse(text) as Record<string, unknown>;
        const providers =
          data.providers && typeof data.providers === 'object' ? (data.providers as Record<string, unknown>) : {};
        const block = providers[record.provider];
        if (!block || typeof block !== 'object') continue;
        const recordBlock = block as Record<string, unknown>;
        const target = record.model ? jsonModelEntry(recordBlock, record.model, record.provider) : recordBlock;
        if (!target) continue;
        const key = endpointKey(target);
        const current = key ? jsonBaseUrl(target) : null;
        if (typeof current !== 'string' || !sameProxyEndpoint(current, record.written)) continue;
        target[key] = record.original;
        writeFileSync(record.file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      }
    } catch {
      failed.push(record);
    }
  }
  saveRecords(host, failed);
  return failed.length === 0
    ? { ok: true, detail: `${host}: endpoint restored` }
    : {
        ok: false,
        detail: `${host}: ${failed.length} endpoint${failed.length === 1 ? '' : 's'} could not be restored`,
      };
}
