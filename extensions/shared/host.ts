// One source for both hosts; OMP differs in six APIs, detected by shape not name.

import { asPromptArray } from './session-state.ts';
import type { ExtensionApi, ExtensionCtx, PromptInjection, SystemPromptEvent, ToolParams, UiApi } from './types.ts';

/** The zod subset the one tool schema needs. */
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

/** The host fields these adapters read. */
export interface HostHandle {
  zod?: unknown;
  setLabel?: (...args: string[]) => void;
}

export function isPiHost(pi: HostHandle): boolean {
  return !pi.zod;
}

export function setExtensionLabel(pi: HostHandle, label: string): void {
  if (isPiHost(pi)) return;
  pi.setLabel?.(label);
}

export function onHostEvent<E>(pi: ExtensionApi, event: string, handler: (event: E, ctx: ExtensionCtx) => unknown): void {
  if (event === 'session_branch' && isPiHost(pi)) return;
  pi.on<E>(event, handler);
}

export interface SelectOption {
  label: string;
  description?: string;
}

// Returns the option's label on both hosts: pi renders plain strings, so the
// description rides along inside the label and is stripped back out.
export async function hostSelect(
  pi: HostHandle,
  ui: UiApi | undefined,
  title: string,
  options: SelectOption[],
  dialogOptions?: Record<string, unknown>,
): Promise<string | undefined> {
  if (!ui?.select) return undefined;
  if (!isPiHost(pi)) return ui.select(title, options, dialogOptions);
  const shown = options.map((option) => (option.description ? `${option.label} — ${option.description}` : option.label));
  const picked = await ui.select(title, shown, dialogOptions);
  if (picked === undefined) return undefined;
  return options[shown.indexOf(picked)]?.label ?? picked;
}

// `staleMarker` identifies the block an earlier turn added so a mode switch
// replaces it; equality cannot work (blocks contain blank lines) and a leading
// emoji may be absent upstream, so match on a stripped substring.
export function injectPromptText(pi: HostHandle, event: SystemPromptEvent, text: string, staleMarker?: string): PromptInjection | undefined {
  const marker = staleMarker?.replace(/^[^\w]+/, '').trim();
  const dropStale = (parts: string[]): string[] => (marker ? parts.filter((part) => !part.includes(marker)) : parts);
  if (!isPiHost(pi)) return { systemPrompt: [...dropStale(asPromptArray(event.systemPrompt)), text] };
  const options = event.systemPromptOptions;
  if (options && typeof options.appendSystemPrompt === 'string') {
    options.appendSystemPrompt = dropStale([options.appendSystemPrompt]).concat(text).filter(Boolean).join('\n\n');
    return undefined;
  }
  return { systemPrompt: `${dropStale(asPromptArray(event.systemPrompt)).join('\n\n')}\n\n${text}` };
}

export interface StringArraySpec {
  minItems?: number;
  description?: string;
}

// One string-array argument in the active host's dialect. pi only requires an
// object, so a JSON Schema literal suffices and no `typebox` import is needed.
export function stringArrayToolParams(pi: ExtensionApi, name: string, spec: StringArraySpec = {}): ToolParams {
  if (!isPiHost(pi)) {
    const { z } = pi.zod as { z: ZodFactory['z'] };
    const array = z.array(z.string());
    const constrained = spec.minItems ? array.min(spec.minItems) : array;
    return z.object({ [name]: spec.description ? constrained.describe(spec.description) : constrained });
  }
  const array: Record<string, unknown> = { type: 'array', items: { type: 'string' } };
  if (spec.minItems) array.minItems = spec.minItems;
  if (spec.description) array.description = spec.description;
  return { type: 'object', properties: { [name]: array }, required: [name] };
}
