// cli/interactive.ts — TTY layer: readline, Clack spinners, selects, task phases.
import readline from 'node:readline';
import { cancel as clackCancel, confirm as clackConfirm, select as clackSelect, spinner as clackSpinner, tasks as clackTasks } from '@clack/prompts';
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

async function askInteractiveChoice(message: string, options: Array<{ value: string; label: string; hint?: string }>, initialValue: string): Promise<InteractiveChoice> {
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
// Run collecting work under one TTY-only Clack task. Callers print after the
// task completes, keeping normal output out of the spinner animation.
async function runInteractivePhase<T>(title: string, collect: () => Promise<T>): Promise<T> {
  if (!tty()) return collect();
  closeRL();
  let result!: T;
  await clackTasks([{ title, task: async () => { result = await collect(); } }]);
  return result;
}
async function execNetwork(label: string, cmd: string, args: string[], opts: ExecOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return withInteractiveSpinner(label, () => execP(cmd, args, opts));
}

export {
  ask, closeRL, tty, withInteractiveSpinner, execNetwork,
  askInteractiveChoice, askInteractiveConfirm, runInteractivePhase, InteractiveChoice, InteractiveConfirm,
};
