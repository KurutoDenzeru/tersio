// extensions/pi/shared/usage-ledger.ts — repo-only import shim.
//
// The canonical ledger is extensions/shared/usage-ledger.ts. The Pi modules
// reach it as `../shared/usage-ledger.ts` — the same specifier they use once
// installed under <agent-dir>/extensions/, where extensions/shared/ sits
// beside the extension directories. This repo keeps that two levels higher, so
// without this file the specifier would differ between the repo and the
// installed tree.
//
// Not shipped: the installer copies extensions/shared/usage-ledger.ts instead.
export * from '../../shared/usage-ledger.ts';
