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
  hostId?: 'pi' | 'omp' | 'opencode' | 'pig';
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
  /** The resume, branch, and compaction events this host emits. A mode restores on each of them. */
  sessionChanges: readonly string[];
  /** True when the host emits `tool_call` and `tool_result`, so a shell hook can rewrite and filter there. */
  toolLifecycle: boolean;
  select(
    ui: UiApi | undefined,
    title: string,
    options: SelectOption[],
    dialogOptions?: Record<string, unknown>,
  ): Promise<string | undefined>;
  inject(event: SystemPromptEvent, block: PromptBlock): PromptInjection | undefined;
  stringArray(pi: ExtensionApi, name: string, spec: StringArraySpec): ToolParams;
}

/** The stale block is dropped by its marker, then the new block is appended as its own prompt part. */
function appendBlock(event: SystemPromptEvent, block: PromptBlock): PromptInjection {
  const marker = block.staleMarker?.replace(/^[^\w]+/, '').trim();
  const kept = marker
    ? asPromptArray(event.systemPrompt).filter((part) => !part.includes(marker))
    : asPromptArray(event.systemPrompt);
  return { systemPrompt: [...kept, block.text] };
}

/** A JSON Schema array parameter, which pi and OpenCode both accept. OMP wants zod, so it builds its own. */
function jsonArrayParams(name: string, spec: StringArraySpec): ToolParams {
  const array: Record<string, unknown> = { type: 'array', items: { type: 'string' } };
  if (spec.minItems) array.minItems = spec.minItems;
  if (spec.description) array.description = spec.description;
  return { type: 'object', properties: { [name]: array }, required: [name] };
}

// pi reports a branch switch as session_tree and emits no session_branch.
const piAdapter: HostAdapter = {
  label() {
    /* no label surface */
  },
  on(pi, event, handler) {
    if (event === 'session_branch') return;
    pi.on(event, handler);
  },
  sessionChanges: ['session_tree', 'session_switch', 'session_compact'],
  toolLifecycle: true,
  async select(ui, title, options, dialogOptions) {
    if (!ui?.select) return undefined;
    const shown = options.map((o) => (o.description ? `${o.label} — ${o.description}` : o.label));
    const picked = await ui.select(title, shown, dialogOptions);
    if (picked === undefined) return undefined;
    return options[shown.indexOf(picked)]?.label ?? picked;
  },
  inject(event, block) {
    const marker = block.staleMarker?.replace(/^[^\w]+/, '').trim();
    const dropStale = (parts: string[]): string[] => (marker ? parts.filter((part) => !part.includes(marker)) : parts);
    const options = event.systemPromptOptions;
    // A named section is replaced in place; returning systemPrompt replaces the whole prompt.
    const sections = options?.sections;
    if (block.sectionTag && sections && typeof sections === 'object') {
      sections[block.sectionTag] = block.text;
      return undefined;
    }
    if (options && typeof options.appendSystemPrompt === 'string') {
      options.appendSystemPrompt = dropStale([options.appendSystemPrompt])
        .concat(block.text)
        .filter(Boolean)
        .join('\n\n');
      return undefined;
    }
    return { systemPrompt: `${dropStale(asPromptArray(event.systemPrompt)).join('\n\n')}\n\n${block.text}` };
  },
  stringArray(_pi, name, spec) {
    return jsonArrayParams(name, spec);
  },
};

// OMP emits every switch event, including session_branch and its own session_tree.
const ompAdapter: HostAdapter = {
  label(pi, text) {
    pi.setLabel?.(text);
  },
  on(pi, event, handler) {
    pi.on(event, handler);
  },
  sessionChanges: ['session_tree', 'session_branch', 'session_switch', 'session_compact'],
  toolLifecycle: true,
  async select(ui, title, options, dialogOptions) {
    if (!ui?.select) return undefined;
    return ui.select(title, options, dialogOptions);
  },
  inject(event, block) {
    return appendBlock(event, block);
  },
  stringArray(pi, name, spec) {
    const { z } = pi.zod as { z: ZodFactory['z'] };
    const array = z.array(z.string());
    const constrained = spec.minItems ? array.min(spec.minItems) : array;
    return z.object({ [name]: spec.description ? constrained.describe(spec.description) : constrained });
  },
};

// OpenCode drives one session per hook payload, so only the start event is replayed for an unseen session.
const opencodeAdapter: HostAdapter = {
  label() {
    /* no label surface */
  },
  on(pi, event, handler) {
    pi.on(event, handler);
  },
  sessionChanges: [],
  // server.ts drives its own before/after tool hooks, so these events never reach an extension here.
  toolLifecycle: false,
  async select(ui, title, options, dialogOptions) {
    if (!ui?.select) return undefined;
    return ui.select(title, options, dialogOptions);
  },
  inject(event, block) {
    return appendBlock(event, block);
  },
  stringArray(_pi, name, spec) {
    return jsonArrayParams(name, spec);
  },
};

// One host derivation, so the adapters and the predicates below cannot disagree about who is running.
function hostOf(pi: HostHandle): 'pi' | 'omp' | 'opencode' | 'pig' {
  if (pi.hostId === 'opencode') return 'opencode';
  if (pi.hostId === 'omp') return 'omp';
  if (pi.hostId === 'pig') return 'pig';
  if (pi.hostId === 'pi') return 'pi';
  // The zod factory is the only host signal a caller without hostId can offer.
  return pi.zod ? 'omp' : 'pi';
}

/** Which host this ExtensionApi belongs to; the settings readers scope the per-host layer with it. */
export function hostIdOf(pi: HostHandle): 'omp' | 'pi' | 'pig' | 'opencode' {
  return hostOf(pi);
}

const ADAPTERS: Record<ReturnType<typeof hostOf>, HostAdapter> = {
  pi: piAdapter,
  pig: piAdapter,
  omp: ompAdapter,
  opencode: opencodeAdapter,
};

function adapterFor(pi: HostHandle): HostAdapter {
  return ADAPTERS[hostOf(pi)];
}

export function isPiHost(pi: HostHandle): boolean {
  return hostOf(pi) === 'pi';
}

export function isPigHost(pi: HostHandle): boolean {
  return hostOf(pi) === 'pig';
}

/** The omp runtime carries a zod factory; pi and OpenCode do not. */
export function isOmpHost(pi: HostHandle): boolean {
  return hostOf(pi) === 'omp';
}

export function isOpencodeHost(pi: HostHandle): boolean {
  return hostOf(pi) === 'opencode';
}

export function setExtensionLabel(pi: HostHandle, text: string): void {
  adapterFor(pi).label(pi, text);
}

export function onHostEvent<E>(
  pi: ExtensionApi,
  event: string,
  handler: (event: E, ctx: ExtensionCtx) => unknown,
): void {
  adapterFor(pi).on<E>(pi, event, handler);
}

/** The resume, branch, and compaction events this host emits, so a mode restores without naming any host. */
export function sessionChangeEvents(pi: HostHandle): readonly string[] {
  return adapterFor(pi).sessionChanges;
}

/** True when a shell hook may register `tool_call` and `tool_result` on this host. */
export function hasToolLifecycle(pi: HostHandle): boolean {
  return adapterFor(pi).toolLifecycle;
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

/** One prompt block: its text, the section tag that owns it, and prior text to drop. */
export interface PromptBlock {
  text: string;
  sectionTag?: string;
  staleMarker?: string;
}

export function injectPromptText(
  pi: HostHandle,
  event: SystemPromptEvent,
  block: PromptBlock,
): PromptInjection | undefined {
  return adapterFor(pi).inject(event, block);
}

export function stringArrayToolParams(pi: ExtensionApi, name: string, spec: StringArraySpec = {}): ToolParams {
  return adapterFor(pi).stringArray(pi, name, spec);
}
