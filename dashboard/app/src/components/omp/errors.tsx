// Errors: failed requests in the range, grouped by signature, with the rows behind them.
import { useMemo, useState } from "react";
import { Card, PagedTable, MeterCell, Page, PageHeader, SearchInput, Stat, StatGrid } from "@/components/charts";
import type { Column } from "@/components/charts";
import { ProviderMark, VendorMark } from "@/components/brand";
import { EmptyState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { displayModel, fmt, fmtShort, projectLabel, relAge, whenStamp } from "@/lib/format";
import type { OmpErrorGroup, OmpRequestRow, OmpStats } from "@/lib/data";

// The reference window phrases, so the page copy reads like the one it mirrors.
const WINDOW: Record<OmpStats["range"], string> = {
  "1h": "the last hour",
  "24h": "the last 24 hours",
  "7d": "the last 7 days",
  "30d": "the last 30 days",
  "90d": "the last 90 days",
  all: "all time",
};

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const PREFIXED_ID_RE = /\b(?:req|msg|call|toolu|chatcmpl|resp|run|gen)[-_][A-Za-z0-9_-]{6,}/g;
const HEX_RE = /\b[0-9a-f]{12,}\b/gi;
const NUMBER_RE = /(?<![\w.-])\d+(?:\.\d+)?/g;
const HTTP_STATUS_RE = /^[1-5]\d\d$/;
const SIGNATURE_MAX = 180;

/**
 * Mirrors the grouping in extensions/shared/omp-stats.ts. The server ships groups, but a
 * row carries no signature, so the filter below has to derive the same bucket locally.
 */
function errorSignature(message: string | null): string {
  if (!message?.trim()) return "Unknown error";
  const normalized = message
    .replace(/\s+/g, " ")
    .trim()
    .replace(UUID_RE, "<id>")
    .replace(PREFIXED_ID_RE, "<id>")
    .replace(HEX_RE, "<hex>")
    .replace(NUMBER_RE, (n) => (HTTP_STATUS_RE.test(n) ? n : "N"));
  return normalized.length > SIGNATURE_MAX ? `${normalized.slice(0, SIGNATURE_MAX - 1)}…` : normalized;
}

function modelKey(row: Pick<OmpRequestRow, "model" | "provider">): string {
  return `${row.model}\u0000${row.provider}`;
}

export function ErrorsPage({
  omp,
  money,
  onOpenRequest,
}: {
  omp: OmpStats;
  money: (v: number) => string;
  onOpenRequest: (row: OmpRequestRow) => void;
}) {
  const [signatureFilter, setSignatureFilter] = useState<string | null>(null);
  const [modelFilter, setModelFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const windowLabel = WINDOW[omp.range];
  const rows = useMemo(
    () => omp.errors.map((row) => ({ row, signature: errorSignature(row.errorMessage) })),
    [omp.errors],
  );
  const newest = rows[0]?.row ?? null;
  // The failure list is capped, so it covers the range only when it matches the range total.
  const complete = rows.length >= omp.overall.failed;
  const maxGroup = omp.errorGroups[0]?.count ?? 0;
  const maxModel = omp.errorModels[0]?.count ?? 0;

  // Selections that no longer exist in this range's data are ignored.
  const signature = omp.errorGroups.some((g) => g.signature === signatureFilter) ? signatureFilter : null;
  const model = omp.errorModels.some((m) => modelKey(m) === modelFilter) ? modelFilter : null;
  const selectedGroup = omp.errorGroups.find((g) => g.signature === signature) ?? null;
  const selectedModel = omp.errorModels.find((m) => modelKey(m) === model) ?? null;

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows
      .filter(
        ({ row, signature: rowSignature }) =>
          (signature === null || rowSignature === signature) &&
          (model === null || modelKey(row) === model) &&
          (needle === "" ||
            row.model.toLowerCase().includes(needle) ||
            row.provider.toLowerCase().includes(needle) ||
            row.project.toLowerCase().includes(needle) ||
            (row.errorMessage ?? "").toLowerCase().includes(needle)),
      )
      .map((entry) => entry.row);
  }, [rows, signature, model, search]);

  return (
    <Page>
      <PageHeader
        title="Errors"
        description={`Failed model requests in ${windowLabel}, grouped by error signature. Open a failure for its full payload.`}
      />

      <StatGrid cols={4}>
        <Stat
          label="Failures"
          value={fmt(rows.length)}
          hint={complete ? `in ${windowLabel}` : `latest ${fmt(rows.length)} loaded`}
        />
        <Stat
          label="Signatures"
          title="Distinct error messages after normalizing ids and numbers"
          value={fmt(omp.errorGroups.length)}
          hint={omp.errorGroups[0] ? `top: ${fmt(omp.errorGroups[0].count)} failures` : undefined}
        />
        <Stat label="Affected models" value={fmt(omp.errorModels.length)} hint={omp.errorModels[0]?.model} />
        <Stat
          label="Last failure"
          value={newest ? relAge(newest.ts) : "–"}
          hint={newest ? whenStamp(newest.ts) : `none in ${windowLabel}`}
        />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card
          title="Error signatures"
          description="Same message with ids and counters normalized. Select one to filter the failures below."
          flush
        >
          <PagedTable
            columns={GROUP_COLUMNS(maxGroup)}
            rows={omp.errorGroups}
            rowKey={(group) => group.signature}
            onRowClick={(group) => setSignatureFilter(signature === group.signature ? null : group.signature)}
            perPage={12}
            ariaLabel="Error signatures"
            empty={
              <EmptyState
                icon="circle-slash"
                title={`No failures in ${windowLabel}`}
                desc="Every request succeeded or was aborted."
              />
            }
          />
          {selectedGroup && <SignatureDetail group={selectedGroup} onOpenRequest={onOpenRequest} />}
        </Card>

        <Card title="By model" description="Failures per model. Select one to filter." flush>
          <PagedTable
            columns={MODEL_COLUMNS(maxModel)}
            rows={omp.errorModels}
            rowKey={(row) => modelKey(row)}
            onRowClick={(row) => setModelFilter(model === modelKey(row) ? null : modelKey(row))}
            perPage={12}
            ariaLabel="Failures by model"
            empty={<EmptyState icon="circle-slash" title="No affected models" desc="No model failed in this window." />}
          />
        </Card>
      </div>

      <Card
        title="Failures"
        description={`${fmt(filtered.length)} of ${fmt(rows.length)} failures, newest first`}
        actions={
          <>
            {signature !== null && (
              <Button
                variant="outline"
                size="sm"
                className="mono max-w-[220px] gap-1.5 border-line text-[11px]"
                title={signature}
                onClick={() => setSignatureFilter(null)}
              >
                <span className="truncate">{signature}</span>
                <Icon name="x" className="size-3" />
              </Button>
            )}
            {selectedModel && (
              <Button
                variant="outline"
                size="sm"
                className="mono max-w-[200px] gap-1.5 border-line text-[11px]"
                onClick={() => setModelFilter(null)}
              >
                <span className="truncate">{displayModel(selectedModel.model)}</span>
                <Icon name="x" className="size-3" />
              </Button>
            )}
            <SearchInput label="Search failures" value={search} onChange={setSearch} placeholder="Message, model or project" />
          </>
        }
        flush
      >
        <PagedTable
          columns={buildFailureColumns(money)}
          rows={filtered}
          rowKey={(row) => `${row.sessionFile}:${row.entryId}`}
          onRowClick={onOpenRequest}
          initialSort={{ key: "time", dir: "desc" }}
          perPage={25}
          ariaLabel="Failures"
          empty={
            <EmptyState
              icon="circle-slash"
              title={rows.length === 0 ? `No failures in ${windowLabel}` : "No failures match"}
              desc={rows.length === 0 ? "Every request succeeded or was aborted." : "Clear the search or the selected filters."}
            />
          }
        />
        {!complete && (
          <p className="mono m-0 border-t border-line px-3.5 py-2.5 text-[11px] text-dim">
            Showing the latest {fmt(rows.length)} failures in {windowLabel}; older ones are not loaded.
          </p>
        )}
      </Card>
    </Page>
  );
}

function GROUP_COLUMNS(maxCount: number): Array<Column<OmpErrorGroup>> {
  return [
    {
      key: "signature",
      header: "Signature",
      sort: (group) => group.signature,
      render: (group) => (
        <span className="mono block max-w-[520px] truncate" title={group.latest.errorMessage ?? undefined}>
          {group.signature}
        </span>
      ),
    },
    {
      key: "models",
      header: "Models",
      sort: (group) => group.models.length,
      render: (group) => (
        <span className="flex min-w-0 items-center gap-2">
          <VendorMark model={group.models[0]?.model ?? ""} small />
          <span className="min-w-0">
            <span className="mono block truncate">{group.models[0] ? displayModel(group.models[0].model) : "–"}</span>
            <span className="block truncate text-[11px] text-dim">
              {group.models.length > 1 ? `+${group.models.length - 1} more` : group.models[0]?.provider}
            </span>
          </span>
        </span>
      ),
    },
    {
      key: "last",
      header: "Last seen",
      sort: (group) => group.lastSeen,
      render: (group) => (
        <span className="text-dim" title={whenStamp(group.lastSeen)}>
          {relAge(group.lastSeen)}
        </span>
      ),
    },
    {
      key: "count",
      header: "Failures",
      align: "right",
      width: 120,
      sort: (group) => group.count,
      render: (group) => (
        <span className="flex items-center justify-end gap-2">
          <span className="mono text-xs tabular-nums">{fmt(group.count)}</span>
          <MeterCell value={group.count} max={maxCount} color="var(--danger)" label={`${fmt(group.count)} failures`} />
        </span>
      ),
    },
  ];
}

function MODEL_COLUMNS(maxCount: number): Array<Column<OmpStats["errorModels"][number]>> {
  return [
    {
      key: "model",
      header: "Model",
      sort: (row) => row.count,
      render: (row) => (
        <span className="flex min-w-0 items-center gap-2">
          <VendorMark model={row.model} small />
          <span className="min-w-0">
            <span className="mono block truncate">{displayModel(row.model)}</span>
            <span className="flex items-center gap-1.5 text-[11px] text-dim">
              <ProviderMark provider={row.provider} small />
              <span className="truncate">{row.provider || "–"}</span>
            </span>
          </span>
        </span>
      ),
    },
    {
      key: "count",
      header: "Failures",
      align: "right",
      sort: (row) => row.count,
      render: (row) => (
        <span className="flex items-center justify-end gap-2">
          <span className="mono text-xs tabular-nums">{fmt(row.count)}</span>
          <MeterCell value={row.count} max={maxCount} color="var(--danger)" label={`${fmt(row.count)} failures`} />
        </span>
      ),
    },
  ];
}

function SignatureDetail({
  group,
  onOpenRequest,
}: {
  group: OmpErrorGroup;
  onOpenRequest: (row: OmpRequestRow) => void;
}) {
  return (
    <div className="border-t border-line px-3.5 py-3">
      <pre className="mono m-0 max-h-40 overflow-auto rounded-lg border border-line bg-track/40 p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
        {group.latest.errorMessage ?? "Unknown error"}
      </pre>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-dim">
          {fmt(group.count)} failures · first {whenStamp(group.firstSeen)} · last {whenStamp(group.lastSeen)}
        </span>
        <Button variant="outline" size="sm" className="border-line" onClick={() => onOpenRequest(group.latest)}>
          Open latest
          <Icon name="arrow-up-right" className="size-3.5" />
        </Button>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {group.models.map((m) => (
          <span
            key={`${m.model}\u0000${m.provider}`}
            className="mono inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11px]"
          >
            {displayModel(m.model)} <span className="text-dim">{m.provider || "–"}</span>{" "}
            <span className="tabular-nums text-dim">{fmtShort(m.count)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function buildFailureColumns(money: (v: number) => string): Array<Column<OmpRequestRow>> {
  return [
  {
    key: "time",
    header: "When",
    width: 120,
    sort: (row) => row.ts,
    render: (row) => (
      <span className="text-dim" title={whenStamp(row.ts)}>
        {relAge(row.ts)}
      </span>
    ),
  },
  {
    key: "model",
    header: "Model",
    sort: (row) => row.model,
    render: (row) => (
      <span className="flex min-w-0 items-center gap-2">
        <VendorMark model={row.model} small />
        <span className="mono truncate">{displayModel(row.model)}</span>
      </span>
    ),
  },
  {
    key: "error",
    header: "Error",
    sort: (row) => row.errorMessage ?? "",
    render: (row) => (
      <span className="mono block max-w-[420px] truncate" title={row.errorMessage ?? undefined}>
        {row.errorMessage ?? "Unknown error"}
      </span>
    ),
  },
  {
    key: "project",
    header: "Project",
    sort: (row) => row.project,
    render: (row) => (
      <span className="mono text-dim" title={row.project}>
        {projectLabel(row.project)}
      </span>
    ),
  },
  { key: "tokens", header: "Tokens", align: "right", sort: (row) => row.totalTokens, render: (row) => fmt(row.totalTokens) },
  {
    key: "cost",
    header: "Cost",
    title: "API-equivalent estimate",
    align: "right",
    sort: (row) => row.costUsd,
    render: (row) => money(row.costUsd),
  },
  ];
}
