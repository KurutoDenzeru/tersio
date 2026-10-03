// One source for both hosts; each host-specific behaviour lives in one adapter row.

import { asPromptArray } from './session-state.ts';
import type { ExtensionApi, ExtensionCtx, PromptInjection, SystemPromptEvent, ToolParams, UiApi } from './types.ts';

export interface ZodChain {
  min: (n: number) => ZodChain;
  describe: (text: string) => ZodChain;
}

export interface ZodFactory {
  z: {
    object: (shape: Record<string, unknown>) => ToolParams;
    array: (element: unknown) => ZodChain;
    string: () => ZodChain;
  };
}

export interface HostHandle {
  zod?: unknown;
  setLabel?: (...args: string[]) => void;
  hostId?: 'pi' | 'omp' | 'opencode';
}

export interface SelectOption {
  label: string;
  description?: string;
}

export interface StringArraySpec {
  minItems?: number;
  description?: string;
}

interface HostAdapter {
  label(pi: HostHandle, text: string): void;
  on<E>(pi: ExtensionApi, event: string, handler: (event: E, ctx: ExtensionCtx) => unknown): void;
  select(ui: UiApi | undefined, title: string, options: SelectOption[], dialogOptions?: Record<string, unknown>): Promise<string | undefined>;
  inject(event: SystemPromptEvent, text: string, staleMarker?: string): PromptInjection | undefined;
  stringArray(pi: ExtensionApi, name: string, spec: StringArraySpec): ToolParams;
}

const piAdapter: HostAdapter = {
  label() { /* no label surface */ },
  on(pi, event, handler) {
    if (event === 'session_branch') return;
    pi.on(event, handler);
  },
  async select(ui, title, options, dialogOptions) {
    if (!ui?.select) return undefined;
    const shown = options.map((o) => (o.description ? `${o.label} — ${o.description}` : o.label));
    const picked = await ui.select(title, shown, dialogOptions);
    if (picked === undefined) return undefined;
    return options[shown.indexOf(picked)]?.label ?? picked;
  },
  inject(event, text, staleMarker) {
    const marker = staleMarker?.replace(/^[^\w]+/, '').trim();
    const dropStale = (parts: string[]): string[] => (marker ? parts.filter((part) => !part.includes(marker)) : parts);
    const options = event.systemPromptOptions;
    if (options && typeof options.appendSystemPrompt === 'string') {
      options.appendSystemPrompt = dropStale([options.appendSystemPrompt]).concat(text).filter(Boolean).join('\n\n');
      return undefined;
    }
    return { systemPrompt: `${dropStale(asPromptArray(event.systemPrompt)).join('\n\n')}\n\n${text}` };
  },
  stringArray(_pi, name, spec) {
    const array: Record<string, unknown> = { type: 'array', items: { type: 'string' } };
    if (spec.minItems) array.minItems = spec.minItems;
    if (spec.description) array.description = spec.description;
    return { type: 'object', properties: { [name]: array }, required: [name] };
  },
};

const ompAdapter: HostAdapter = {
  label(pi, text) { pi.setLabel?.(text); },
  on(pi, event, handler) { pi.on(event, handler); },
  async select(ui, title, options, dialogOptions) {
    if (!ui?.select) return undefined;
    return ui.select(title, options, dialogOptions);
  },
  inject(event, text, staleMarker) {
    const marker = staleMarker?.replace(/^[^\w]+/, '').trim();
    const dropStale = (parts: string[]): string[] => (marker ? parts.filter((part) => !part.includes(marker)) : parts);
    return { systemPrompt: [...dropStale(asPromptArray(event.systemPrompt)), text] };
  },
  stringArray(pi, name, spec) {
    const { z } = pi.zod as { z: ZodFactory['z'] };
    const array = z.array(z.string());
    const constrained = spec.minItems ? array.min(spec.minItems) : array;
    return z.object({ [name]: spec.description ? constrained.describe(spec.description) : constrained });
  },
};

const opencodeAdapter: HostAdapter = {
  label() { /* no label surface */ },
  on(pi, event, handler) { pi.on(event, handler); },
  async select(ui, title, options, dialogOptions) {
    if (!ui?.select) return undefined;
    return ui.select(title, options, dialogOptions);
  },
  inject(event, text, staleMarker) {
    const marker = staleMarker?.replace(/^[^\w]+/, '').trim();
    const dropStale = (parts: string[]): string[] => (marker ? parts.filter((part) => !part.includes(marker)) : parts);
    return { systemPrompt: [...dropStale(asPromptArray(event.systemPrompt)), text] };
  },
  stringArray(_pi, name, spec) {
    const array: Record<string, unknown> = { type: 'array', items: { type: 'string' } };
    if (spec.minItems) array.minItems = spec.minItems;
    if (spec.description) array.description = spec.description;
    return { type: 'object', properties: { [name]: array }, required: [name] };
  },
};

// Explicit hostId wins; the legacy zod sniff keeps old callers working.
function adapterFor(pi: HostHandle): HostAdapter {
  if (pi.hostId === 'opencode') return opencodeAdapter;
  if (pi.hostId === 'omp') return ompAdapter;
  if (pi.hostId === 'pi') return piAdapter;
  return pi.zod ? ompAdapter : piAdapter;
}

export function isPiHost(pi: HostHandle): boolean {
  return !pi.zod;
}

export function setExtensionLabel(pi: HostHandle, text: string): void {
  adapterFor(pi).label(pi, text);
}

export function onHostEvent<E>(pi: ExtensionApi, event: string, handler: (event: E, ctx: ExtensionCtx) => unknown): void {
  adapterFor(pi).on<E>(pi, event, handler);
}

export async function hostSelect(
  pi: HostHandle,
  ui: UiApi | undefined,
  title: string,
  options: SelectOption[],
  dialogOptions?: Record<string, unknown>,
): Promise<string | undefined> {
  return adapterFor(pi).select(ui, title, options, dialogOptions);
}

export function injectPromptText(pi: HostHandle, event: SystemPromptEvent, text: string, staleMarker?: string): PromptInjection | undefined {
  return adapterFor(pi).inject(event, text, staleMarker);
}

export function stringArrayToolParams(pi: ExtensionApi, name: string, spec: StringArraySpec = {}): ToolParams {
  return adapterFor(pi).stringArray(pi, name, spec);
}
