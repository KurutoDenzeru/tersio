// extensions/shared/host.ts — one extension source, two agent hosts.
//
// OMP is a fork of pi, and six surfaces differ: tool schemas (OMP injects
// `pi.zod`, pi takes any object it forwards as JSON Schema), `setLabel`
// (pi's takes an entryId, so an extension name must never reach it),
// `session_branch` (pi reports that switch as `session_tree`), select options
// (pi takes plain strings), the status-bar theme (pi has no ctx.ui.theme), and
// prompt injection (pi appends to its sections rather than replacing them).
//
// The host is read from the API shape, never a name or an env marker: OMP is
// the fork that injects zod, and pi does not, including through the SDK.

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

// What a `before_agent_start` handler hands back; undefined once pi was
// updated in place.
export function injectPromptText(pi: HostHandle, event: SystemPromptEvent, text: string): PromptInjection | undefined {
  if (!isPiHost(pi)) return { systemPrompt: [...asPromptArray(event.systemPrompt), text] };
  // Appending keeps pi's sections and the transcript diff; replacing the
  // prompt the OMP way would drop every section.
  const options = event.systemPromptOptions;
  if (options && typeof options.appendSystemPrompt === 'string') {
    options.appendSystemPrompt = [options.appendSystemPrompt, text].filter(Boolean).join('\n\n');
    return undefined;
  }
  return { systemPrompt: `${asPromptArray(event.systemPrompt).join('\n\n')}\n\n${text}` };
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
