// cli/interactive.ts — TTY layer: readline, Clack spinners, selects, task phases.
import readline from 'node:readline';
import { cancel as clackCancel, confirm as clackConfirm, log as clackLog, select as clackSelect, spinner as clackSpinner, tasks as clackTasks } from '@clack/prompts';
import type { SpinnerResult } from '@clack/prompts';
import { execP } from './common.ts';
import type { ExecOptions } from './common.ts';

const RL = readline.createInterface({ input: process.stdin, output: process.stdout });
let rlOpen = true;
function ask(q: string): Promise<string> {
  return new Promise<string>((resolve) => {
    if (!rlOpen) { resolve(''); return; }
    try { RL.question(q, resolve); } catch { resolve(''); }
  });
}
function closeRL(): void { if (rlOpen) { RL.close(); rlOpen = false; } }

function tty(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

type InteractiveChoice = { status: 'selected'; value: string } | { status: 'cancelled' | 'unavailable' };

type InteractiveConfirm = { status: 'confirmed'; value: boolean } | { status: 'cancelled' | 'unavailable' };

let spinnerDepth = 0;

// Run async work under a TTY-only timer spinner. The spinner is cleared before
// the caller prints its normal result line, preserving locked output shapes.
async function withInteractiveSpinner<T>(message: string, work: (update: (message: string) => void) => Promise<T>): Promise<T> {
  if (!tty() || spinnerDepth > 0) return work(() => { });
  // Clack manages stdin itself. Close the legacy question interface before its
  // first use; non-interactive callers never reach this branch.
  closeRL();
  const active: SpinnerResult = clackSpinner({ indicator: 'timer' });
  active.start(message);
  spinnerDepth += 1;
  try {
    return await work((next: string) => { active.message(next); });
  } finally {
    active.clear();
    spinnerDepth -= 1;
  }
}

async function askInteractiveChoice(message: string, options: Array<{ value: string; label: string; hint?: string; disabled?: boolean }>, initialValue: string): Promise<InteractiveChoice> {
  if (!tty()) return { status: 'unavailable' };
  closeRL();
  const choice = await clackSelect({ message, options, initialValue });
  if (typeof choice !== 'string') {
    clackCancel('Aborted.');
    return { status: 'cancelled' };
  }
  return { status: 'selected', value: choice };
}
async function askInteractiveConfirm(message: string, initialValue = true): Promise<InteractiveConfirm> {
  if (!tty()) return { status: 'unavailable' };
  closeRL();
  const answer = await clackConfirm({ message, initialValue });
  if (typeof answer !== 'boolean') {
    clackCancel('Aborted.');
    return { status: 'cancelled' };
  }
  return { status: 'confirmed', value: answer };
}
// Confirm a destructive run: a Clack dialog at a terminal, a plain prompt in a
// pipe or script. False means the user declined or aborted.
async function confirmDestructive(message: string): Promise<boolean> {
  if (tty()) {
    closeRL();
    const answer = await clackConfirm({ message, initialValue: false });
    if (typeof answer !== 'boolean') {
      clackCancel('Aborted.');
      closeRL();
      return false;
    }
    if (!answer) {
      console.log('Aborted.');
      closeRL();
      return false;
    }
    return true;
  }
  const typed = await ask('\nProceed? [y/N]: ');
  if (!typed.toLowerCase().startsWith('y')) {
    console.log('Aborted.');
    closeRL();
    return false;
  }
  return true;
}

// Run collecting work under one TTY-only Clack task. Callers print after the
// task completes, keeping normal output out of the spinner animation.
async function runInteractivePhase<T>(title: string, collect: () => Promise<T>): Promise<T> {
  if (!tty()) return collect();
  closeRL();
  let result!: T;
  await clackTasks([{ title, task: async () => { result = await collect(); } }]);
  return result;
}
// Tagged lines log on TTY but stay byte-identical when piped.
type SayKind = 'info' | 'success' | 'warn' | 'error' | 'step' | 'message';
const TAG_KIND: Record<string, SayKind> = {
  fail: 'error', warn: 'warn', hint: 'info', ok: 'success', note: 'message',
  write: 'step', rm: 'step', migrate: 'step', skip: 'info', 'dry-run': 'info',
};
function sayTagged(line: string): void {
  const m = /^\s*\[([\w-]+)\]\s?([\s\S]*)$/.exec(line);
  const kind: SayKind = (m && TAG_KIND[m[1]]) || 'info';
  if (tty() && m) clackLog[kind](m[2]);
  else console.log(line);
}
// One live-updating task line instead of a spinner per step.
async function withInteractiveTask<T>(title: string, work: (update: (message: string) => void) => Promise<T>): Promise<T> {
  if (!tty()) return work(() => { });
  closeRL();
  let result!: T;
  const spin = clackSpinner();
  spin.start(title);
  try {
    result = await work((message) => spin.message(message));
    spin.stop('done');
  } catch (e) {
    spin.error(shortSpinnerError(e));
    throw e;
  }
  return result;
}
function shortSpinnerError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return (msg.split('\n')[0] || 'failed').slice(0, 120);
}
async function execNetwork(label: string, cmd: string, args: string[], opts: ExecOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return withInteractiveSpinner(label, () => execP(cmd, args, opts));
}

export {
  ask, closeRL, tty, withInteractiveSpinner, withInteractiveTask, execNetwork, sayTagged, SayKind,
  askInteractiveChoice, askInteractiveConfirm, confirmDestructive, runInteractivePhase, InteractiveChoice, InteractiveConfirm,
};
