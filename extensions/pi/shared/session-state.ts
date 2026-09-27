// extensions/pi/shared/session-state.ts — repo-only import shim.
//
// The canonical host-free state machine is extensions/shared/session-state.ts;
// both host trees must reach it at their own depth, and the two trees sit at
// different depths in this repo while sharing one depth on disk. This file lets
// the Pi modules use the same `../shared/<module>.ts` specifier here as they do
// once installed, instead of a repo-only spelling that would break on install.
//
// Not shipped. The installer copies the canonical files, so a copy of this
// shim would put two module instances in the Pi process and split the bridge
// the whole mode system is built on. test/cli/pi-wiring.test.ts pins that the
// Pi source list names only canonical files.
export * from '../../shared/session-state.ts';
