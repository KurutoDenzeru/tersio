// extensions/pi/shared/plugin-settings.ts — repo-only import shim.
//
// The canonical defaults store is extensions/shared/plugin-settings.ts. The Pi
// modules reach it as `../shared/plugin-settings.ts` — the same specifier they
// use once installed under <agent-dir>/extensions/, where extensions/shared/
// and extensions/lib/ sit beside the extension directories. This repo keeps
// those two levels higher, so without this file the specifiers would differ
// between the repo and the installed tree and a module that resolves here
// would not resolve there.
//
// Not shipped: the installer copies the canonical file instead, so a copy of
// this shim would not resolve at all once installed.
export * from '../../shared/plugin-settings.ts';
