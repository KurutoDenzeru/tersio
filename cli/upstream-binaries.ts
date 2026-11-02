// Version-only upstream sources (RTK, Headroom): the local binary is the fact, the release feed is
// the drift. One adapter serves both so the scorecard does not duplicate the same shape twice.

import { execFileSync } from 'node:child_process';
import { shimCommand } from '../extensions/shared/utils.ts';
import type { SourceRow } from './upstream.ts';

interface Failure {
  status: SourceRow['status'];
  reason: string;
}

export interface BinarySourceCtx {
  fetchTag: (api: string) => Promise<string | null>;
  classifyFetch: (e: unknown, ref: string) => Failure;
  releaseUrl: (repo: string, version: string) => string;
}

export interface BinarySourceSpec {
  source: string;
  api: string;
  repo: string;
  bin: () => string | null;
  normalize: (value: string | undefined) => string;
  /** An absent binary is a gap (RTK) or the user's choice (Headroom). */
  gapWhenMissing: boolean;
}

export async function checkBinarySource(spec: BinarySourceSpec, ctx: BinarySourceCtx): Promise<SourceRow> {
  const bin = spec.bin();
  let local: string | null = null;
  if (bin) {
    try {
      const shim = shimCommand(bin, ['--version']);
      local = spec.normalize(execFileSync(shim.cmd, shim.args, { encoding: 'utf8', timeout: 5000, windowsHide: true })) || null;
    } catch {
      local = null;
    }
  }
  let latest: string | null = null;
  let failure: Failure | null = null;
  try {
    latest = spec.normalize((await ctx.fetchTag(spec.api)) ?? undefined);
  } catch (e) {
    failure = ctx.classifyFetch(e, `the ${spec.source} release feed`);
  }
  const behind = local && latest && local !== latest;
  return {
    source: spec.source,
    pin: local ?? 'not installed',
    upstream: latest ?? 'unknown',
    tracked: local === null ? 0 : 1,
    matched: local === null ? 0 : 1,
    drift: behind ? 1 : 0,
    added: 0,
    removed: 0,
    ceiling: 0,
    measured: failure === null,
    status: failure ? failure.status : 'ok',
    kind: 'version',
    link: local ? ctx.releaseUrl(spec.repo, local) : '',
    gaps: local === null && spec.gapWhenMissing ? ['the rtk binary is not on PATH'] : [],
    moved: [],
    appeared: [],
    gone: [],
    uncarried: 0,
    uncarriedMoved: 0,
    pinnedAt: null,
    candidate: behind ? latest : null,
    preview: [],
    note: failure ? failure.reason : behind ? `installed ${local} is behind ${latest}` : local === null ? 'binary not on PATH' : '',
  };
}
