// Sources page: the upstream scorecard, which until now only the CLI printed.
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CellBar, Page, PageHeader, PagedTable, Stat, StatGrid } from "@/components/charts";
import type { Column } from "@/components/charts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import { EmptyState } from "@/components/common";
import { Icon } from "@/components/icon";
import { AgentLogo } from "@/components/agent-logos";
import { Bar, BarChart, CartesianGrid, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, XAxis, YAxis } from "recharts";
import { UPCOMING_AGENTS } from "@/lib/agents";
import { fmt } from "@/lib/format";
import { useToast } from "../toaster";

interface SourceRow {
  source: string;
  pin: string;
  tracked: number;
  matched: number;
  drift: number;
  status: string;
  measured: boolean;
  kind: string;
  note: string;
  link: string;
  gaps: string[];
}

interface HostRow {
  host: string;
  installed: boolean;
  files: number;
  matched: number;
  stale: number;
  missing: number;
  /** True for an agent Tersio does not install into yet, so the row carries no numbers. */
  soon?: boolean;
}

interface Scorecard {
  version: string;
  checkedAt: number;
  sources: SourceRow[];
  hosts: HostRow[];
  accuracy: number;
  drift: number;
}

/** The glyph each port carries everywhere else in the project. */
const GLYPH: Record<string, string> = { Caveman: "🪨", RTK: "🗜️", Ponytail: "🧠", pstack: "🥔" };

const AGENT_NAME: Record<string, string> = { omp: "Oh My Pi", pi: "pi", opencode: "OpenCode" };

/** The name a row shows: the installed agents first, then the ones still to come. */
function agentLabel(host: string): string {
  return AGENT_NAME[host] ?? UPCOMING_AGENTS.find((agent) => agent.id === host)?.name ?? host;
}

/** The house status pill: one shape per tone, the way the Providers page draws its own. */
const STATUS: Record<string, { variant: "success" | "outline" | "destructive"; className: string; label: string }> = {
  ok: { variant: "success", className: "mono", label: "ok" },
  offline: { variant: "outline", className: "mono border-[var(--warn-border)] text-[var(--warn-border)]", label: "offline" },
  "pin-missing": { variant: "destructive", className: "mono", label: "pin missing" },
  error: { variant: "destructive", className: "mono", label: "error" },
};

const BADGE_FALLBACK = { variant: "outline" as const, className: "mono border-line text-dim", label: "unmeasured" };

const SCORE_CONFIG = { score: { label: "Accuracy", color: "var(--accent)" } } satisfies ChartConfig;
const COPY_CONFIG = {
  matched: { label: "Matches", color: "var(--accent)" },
  stale: { label: "Stale", color: "var(--warn-border)" },
  missing: { label: "Missing", color: "var(--danger)" },
} satisfies ChartConfig;

/** A port's pin, shortened to the seven characters a commit is named by. */
function shortPin(row: SourceRow): string {
  return row.pin.length > 12 ? row.pin.slice(0, 7) : row.pin;
}

function stamp(ms: number): string {
  return ms > 0 ? new Date(ms).toLocaleString() : "never";
}

/** The pin opens the commit, or the release, at the project it names. */
function PinLink({ row }: { row: SourceRow }) {
  const label = <span className="mono text-[11px] text-dim">{shortPin(row)}</span>;
  if (!row.link) return label;
  return (
    <a
      href={row.link}
      target="_blank"
      rel="noreferrer"
      title={`Open ${shortPin(row)} upstream`}
      className="underline decoration-line underline-offset-2 hover:text-ink hover:decoration-accent"
    >
      {label}
    </a>
  );
}

/** One line per row: the number and its bar sit together, so a table keeps the house row height. */
function MatchCell({ value, max }: { value: number; max: number }) {
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="mono tabular-nums">
        {fmt(value)} / {fmt(max)}
      </span>
      <span className="w-12 shrink-0">
        <CellBar value={value} max={Math.max(1, max)} />
      </span>
    </span>
  );
}

const SOURCE_COLUMNS: Array<Column<SourceRow>> = [
  {
    key: "source",
    header: "Source",
    sort: (r) => r.source,
    render: (r) => (
      <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold">
        <span aria-hidden="true">{GLYPH[r.source] ?? "•"}</span>
        <span className="truncate">{r.source}</span>
      </span>
    ),
  },
  { key: "pin", header: "Pin", sort: (r) => r.pin, render: (r) => <PinLink row={r} /> },
  {
    key: "matched",
    header: "Matched",
    align: "right",
    sort: (r) => r.matched / Math.max(1, r.tracked),
    render: (r) => <MatchCell value={r.matched} max={r.tracked} />,
  },
  { key: "drift", header: "Drift", align: "right", sort: (r) => r.drift, render: (r) => <span className="mono tabular-nums">{fmt(r.drift)}</span> },
  {
    key: "status",
    header: "Status",
    sort: (r) => r.status,
    render: (r) => {
      const badge = r.measured ? STATUS[r.status] ?? BADGE_FALLBACK : BADGE_FALLBACK;
      return (
        <Badge variant={badge.variant} className={badge.className}>
          {badge.label}
        </Badge>
      );
    },
  },
];

const AGENT_COLUMNS: Array<Column<HostRow>> = [
  {
    key: "host",
    header: "Agent",
    sort: (r) => r.host,
    render: (r) => (
      <span className="flex min-w-0 items-center gap-2 text-[13px] font-semibold">
        <AgentLogo host={r.host} className="size-5 shrink-0" />
        <span className="truncate">{agentLabel(r.host)}</span>
        {r.soon ? (
          <span className="text-[11px] font-normal text-dim">coming soon</span>
        ) : (
          !r.installed && <span className="text-[11px] font-normal text-dim">not installed</span>
        )}
      </span>
    ),
  },
  { key: "files", header: "Files", align: "right", sort: (r) => r.files, render: (r) => <span className="mono tabular-nums">{r.soon ? "—" : fmt(r.files)}</span> },
  {
    key: "matched",
    header: "Matched",
    align: "right",
    sort: (r) => r.matched / Math.max(1, r.files),
    render: (r) => (r.soon ? <span className="mono text-dim">—</span> : <MatchCell value={r.matched} max={r.files} />),
  },
  { key: "stale", header: "Stale", align: "right", sort: (r) => r.stale, render: (r) => <span className="mono tabular-nums">{r.soon ? "—" : fmt(r.stale)}</span> },
  { key: "missing", header: "Missing", align: "right", sort: (r) => r.missing, render: (r) => <span className="mono tabular-nums">{r.soon ? "—" : fmt(r.missing)}</span> },
];

/** The scorecard: a radar over the ports, a stacked bar per agent, then the two tables side by side. */
export function SourcesPage() {
  const toast = useToast();
  const [card, setCard] = useState<Scorecard | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [checking, setChecking] = useState(false);

  const load = useCallback(() => {
    fetch("/api/upstream")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { card?: Scorecard | null } | null) => setCard(d?.card ?? null))
      .catch(() => { /* the empty state stands */ })
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const check = (): void => {
    setChecking(true);
    void fetch("/api/upstream/check", { method: "POST", signal: AbortSignal.timeout(120_000) })
      .then((r) => r.json())
      .then((d: { ok?: boolean; card?: Scorecard; error?: string }) => {
        if (d?.ok && d.card) {
          setCard(d.card);
          toast("Scorecard refreshed", `${d.card.accuracy}% of the tracked bodies match their pin.`, "check");
        } else {
          toast("Check failed", d?.error ?? "The server did not answer.", "circle-alert");
        }
      })
      .catch(() => toast("Check failed", "No answer from the server. `tersio upstream` runs the same check.", "circle-alert"))
      .finally(() => setChecking(false));
  };

  const gaps = (card?.sources ?? []).flatMap((row) => row.gaps.map((gap) => ({ source: row.source, gap })));
  const perSource = (card?.sources ?? []).map((row) => ({
    source: row.source,
    pct: row.tracked > 0 ? Math.round((row.matched / row.tracked) * 1000) / 10 : 0,
  }));
  // The table names every agent Tersio knows of, so the two still to come sit with the rest.
  const agentTableRows: HostRow[] = [
    ...(card?.hosts ?? []),
    ...UPCOMING_AGENTS.map((agent) => ({ host: agent.id, installed: false, files: 0, matched: 0, stale: 0, missing: 0, soon: true })),
  ];
  const agentRows = (card?.hosts ?? []).map((row) => ({
    host: row.host,
    label: AGENT_NAME[row.host] ?? row.host,
    matched: row.matched,
    stale: row.stale,
    missing: row.missing,
    rest: Math.max(0, row.files - row.matched - row.stale - row.missing),
  }));

  return (
    <Page>
      <PageHeader
        title="Sources"
        description="Every mode Tersio ports, against the project it came from. A check reads each upstream repository, then names what moved and how each installed agent compares."
        actions={
          <Button size="sm" className="mono h-8 gap-1.5 rounded-xl" disabled={checking} onClick={check}>
            <Icon name="rotate-ccw" className="size-3.5" />
            <span>{checking ? "Checking upstream" : "Check upstream"}</span>
          </Button>
        }
      />

      {!loaded ? null : !card ? (
        <EmptyState
          icon="layers"
          title="No scorecard yet"
          desc="A check reads each upstream project and writes the scorecard to ~/.tersio/upstream/. It needs the network."
        />
      ) : (
        <>
          <StatGrid cols={4}>
            <Stat label="Accuracy" value={`${card.accuracy}%`} icon="check" />
            <Stat label="Drift" value={fmt(card.drift)} hint="files past the pin" icon="git-branch" />
            <Stat label="Sources" value={fmt(card.sources.length)} hint={`pin ${card.version}`} icon="layers" />
            <Stat label="Checked" value={stamp(card.checkedAt)} hint="local time" icon="clock" />
          </StatGrid>

          <div className="grid gap-3 lg:grid-cols-3">
            <Card title="Port accuracy" icon="check" description="Each port's tracked bodies, matched against its pin.">
              <figure className="m-0">
                <ChartContainer config={SCORE_CONFIG} className="mx-auto h-[190px] w-full max-w-[260px]" role="img" aria-label="Accuracy per port">
                  <RadarChart data={perSource} outerRadius="72%">
                    <PolarGrid stroke="var(--line)" />
                    <PolarAngleAxis dataKey="source" tick={{ fill: "var(--dim)", fontSize: 11 }} />
                    <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                    <Radar dataKey="pct" name="Accuracy" stroke="var(--color-score)" fill="var(--color-score)" fillOpacity={0.35} isAnimationActive={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                  </RadarChart>
                </ChartContainer>
                <figcaption className="mono mt-1 text-[11px] text-dim">
                  {perSource.map((row) => `${row.source} ${row.pct}%`).join(" · ")}
                </figcaption>
              </figure>
            </Card>

            <Card
              title="Agent copies"
              icon="layers"
              description="What each installed agent carries, against this build's own tree."
              className="lg:col-span-2"
            >
              <figure className="m-0">
                <ChartContainer config={COPY_CONFIG} className="h-[190px] w-full" role="img" aria-label="Files per agent, split by match, stale, and missing">
                  <BarChart data={agentRows} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
                    <CartesianGrid horizontal={false} stroke="var(--line)" />
                    <XAxis type="number" tickLine={false} axisLine={false} allowDecimals={false} tick={{ fill: "var(--dim)", fontSize: 11 }} />
                    <YAxis type="category" dataKey="label" width={72} tickLine={false} axisLine={false} tick={{ fill: "var(--dim)", fontSize: 11 }} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="matched" stackId="copies" fill="var(--color-matched)" isAnimationActive={false} />
                    <Bar dataKey="stale" stackId="copies" fill="var(--color-stale)" isAnimationActive={false} />
                    <Bar dataKey="missing" stackId="copies" fill="var(--color-missing)" radius={[0, 3, 3, 0]} isAnimationActive={false} />
                    <ChartLegend content={<ChartLegendContent />} />
                  </BarChart>
                </ChartContainer>
                <figcaption className="mono mt-1 text-[11px] text-dim">
                  {agentRows.map((row) => `${row.label} ${row.matched}/${row.matched + row.stale + row.missing + row.rest}`).join(" · ")}
                </figcaption>
              </figure>
            </Card>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Card
              title="Ports"
              icon="layers"
              description="A tracked body counts as matched when its bytes match the pin, or when a declared fork is present."
            >
              <PagedTable columns={SOURCE_COLUMNS} rows={card.sources} rowKey={(row) => row.source} ariaLabel="Ports" perPage={10} />
            </Card>

            <Card title="Agents" icon="layers" description="What each agent carries against this build's own tree, and the two still to come.">
              <PagedTable columns={AGENT_COLUMNS} rows={agentTableRows} rowKey={(row) => row.host} ariaLabel="Agents" perPage={10} />
            </Card>
          </div>

          {gaps.length > 0 && (
            <Card title="Gaps" icon="circle-alert" description="Bodies that are absent or differ, by local path.">
              <ul className="m-0 grid list-none gap-1 p-0">
                {gaps.map(({ source, gap }) => (
                  <li key={`${source}-${gap}`} className="mono flex min-w-0 gap-2 text-[11px] text-dim">
                    <span className="shrink-0 font-semibold text-ink">{source}</span>
                    <span className="truncate">{gap}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </Page>
  );
}
