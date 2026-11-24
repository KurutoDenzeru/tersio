// The upstream CodeGraph bundle this machine resolves, whether installed by Tersio or supplied by the user.

import fs from 'node:fs';
import path from 'node:path';
import { codegraphRegistry } from '../extensions/codegraph/install.ts';
import { resolveCodeGraphLibrary } from '../extensions/codegraph/shared.ts';
import { homeDir } from '../extensions/shared/utils.ts';

const UPSTREAM_PACKAGE = '@colbymchenry/codegraph';

/** The npm registry's newest upstream release, read the same way the other add-ons are read. */
export const CODEGRAPH_NPM_LATEST = `${codegraphRegistry()}/@colbymchenry/codegraph/latest`;

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

export type CodeGraphCliLink = 'linked' | 'current' | 'kept' | 'none';

/**
 * Expose the bundled upstream CLI at ~/.local/bin/codegraph, so `codegraph` works in a shell the way
 * the upstream installer would leave it. The link never replaces a codegraph the user already has,
 * and Windows stays out: its bin is a POSIX script and the upstream installer owns PATH there.
 */
export async function linkCodeGraphCli(): Promise<CodeGraphCliLink> {
  if (process.platform === 'win32') return 'none';
  const lib = resolveCodeGraphLibrary();
  if (lib === null) return 'none';
  const bin = path.resolve(path.dirname(lib), '..', '..', 'bin', 'codegraph');
  if (!fs.existsSync(bin)) return 'none';
  const dir = path.join(homeDir(), '.local', 'bin');
  const link = path.join(dir, 'codegraph');
  // Replace only a symlink we own: a stale one points at a bundle version that update swept away.
  try {
    if (fs.readlinkSync(link) === bin) return 'current';
    if (fs.lstatSync(link).isSymbolicLink()) {
      fs.unlinkSync(link);
      fs.symlinkSync(bin, link);
      return 'linked';
    }
    // A regular file sits there: that is the user's own codegraph, never touched.
    return 'kept';
  } catch {
    /* no link yet, or a regular file readlink cannot name */
  }
  if (fs.existsSync(link)) return 'kept';
  // A codegraph anywhere on PATH is the user's own install; adding ours would only shadow it.
  const onPath = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((entry) => [path.join(entry, 'codegraph'), path.join(entry, 'codegraph.cmd')])
    .find((candidate) => {
      try {
        return fs.statSync(candidate).isFile() && path.relative(link, candidate) !== '';
      } catch {
        return false;
      }
    });
  if (onPath) return 'kept';
  fs.mkdirSync(dir, { recursive: true });
  fs.symlinkSync(bin, link);
  return 'linked';
}
