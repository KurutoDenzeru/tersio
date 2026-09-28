// extensions/shared/host.ts — one extension source, two agent hosts.
//
// OMP (github.com/can1357/oh-my-pi) is a fork of pi
// (github.com/earendil-works/pi-coding-agent). Six surfaces differ between
// them, and every one is handled here so the extensions never branch on host:
//
//   1. Tool schemas. OMP injects a zod builder as `pi.zod`; pi takes a plain
//      object schema and hands it to the provider as JSON Schema.
//   2. Extension labels. OMP: `pi.setLabel(label)`. pi: `setLabel(entryId,
//      label)` marks a session entry, so an extension name must never reach it.
//   3. Branch switches. OMP emits `session_branch`; pi reports the same switch
//      as `session_tree`, so `session_branch` is OMP-only here.
//   4. Select dialogs. OMP takes `{label, description}[]`; pi takes `string[]`.
//   5. Status text. OMP colors through `ctx.ui.theme.fg`; pi has no
//      `ctx.ui.theme` (see themeStatus in session-state.ts).
//   6. Prompt injection. OMP replaces the prompt with a string array; pi keeps
//      the structured prompt sections and appends to them.
//
// The host is detected from the API shape, not from a name or an env marker:
// OMP is the fork that injects zod, and pi does not — including pi embedded
// through the SDK, which sets no `PI_CODING_AGENT`.

import { asPromptArray } from './session-state.ts';
import type { ExtensionApi, ExtensionCtx, PromptInjection, SystemPromptEvent, ToolParams, UiApi } from './types.ts';

/** The zod subset tersio needs for its one tool schema. */
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

/** The part of the host object these adapters read. */
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

// Returns the chosen option's label on both hosts: pi renders plain strings
// only, so the description rides along inside the label and comes back out.
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

// The value a `before_agent_start` handler hands back, or undefined when the
// host was already updated in place.
export function injectPromptText(pi: HostHandle, event: SystemPromptEvent, text: string): PromptInjection | undefined {
  if (!isPiHost(pi)) return { systemPrompt: [...asPromptArray(event.systemPrompt), text] };
  // Appending keeps pi's structured sections and the transcript diff small.
  // Replacing the whole prompt the OMP way would drop every section.
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

// Tool parameters for one string-array argument, in the active host's dialect.
// pi only requires an object and forwards it to the provider, so a plain JSON
// Schema literal is enough there and no `typebox` import is needed.
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
