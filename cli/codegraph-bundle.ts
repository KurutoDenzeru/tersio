// The upstream CodeGraph bundle this machine resolves, whether installed by Tersio or supplied by the user.

import fs from 'node:fs';
import path from 'node:path';
import { resolveCodeGraphLibrary } from '../extensions/codegraph/shared.ts';

const UPSTREAM_PACKAGE = '@colbymchenry/codegraph';

/** The npm registry's newest upstream release, read the same way the other add-ons are read. */
export const CODEGRAPH_NPM_LATEST = 'https://registry.npmjs.org/@colbymchenry/codegraph/latest';

/** The version of the resolved bundle, from its own package.json; null when there is none or it is not CodeGraph's. */
export function installedCodegraphVersion(): string | null {
  const lib = resolveCodeGraphLibrary();
  if (lib === null) return null;
  // The entry is <bundle>/lib/dist/index.js, so the bundle's package.json sits two levels above lib/.
  const pkgFile = path.resolve(path.dirname(lib), '..', '..', 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8')) as { name?: unknown; version?: unknown };
    if (typeof pkg.name !== 'string' || !pkg.name.startsWith(UPSTREAM_PACKAGE)) return null;
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}
