// extensions/pi/lib/utils.ts — repo-only import shim.
//
// The canonical helpers are extensions/lib/utils.ts. The Pi modules reach them
// as `../lib/utils.ts` — the same specifier they use once installed under
// <agent-dir>/extensions/, where extensions/lib/ sits beside the extension
// directories. This repo keeps that two levels higher, so without this file
// the specifier would differ between the repo and the installed tree.
//
// Not shipped: the installer copies extensions/lib/utils.ts into the tree.
export * from '../../lib/utils.ts';
