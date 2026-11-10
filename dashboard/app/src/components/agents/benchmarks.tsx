// Benchmarks page, laid out as a report: a masthead of headline figures, distinct chart treatments
// rather than one shape repeated, then one spread per published result file. Every number is parsed
// from docs/BENCH_*.md by the API, so the page cannot claim a figure the docs do not carry.
import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, Page } from "@/components/charts"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import type { ChartConfig } from "@/components/ui/chart"
import { EmptyState } from "@/components/common"
import { Icon } from "@/components/icon"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "cn"
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
} from "recharts"

interface BenchTable {
  title: string
  columns: string[]
  rows: string[][]
}

interface BenchFile {
  id: string
  title: string
  meta: Record<string, string>
  tables: BenchTable[]
  findings: string[]
}

interface Payload {
  ok: boolean
  dir: string
  files: BenchFile[]
}

interface Point {
  name: string
  value: number
}

/** A cell as a number: "-15.1%", "+1,044" and "12/15" all read as the figure they state. */
function cellNumber(cell: string | undefined): number | null {
  if (!cell) return null
  const text = cell.trim().toLowerCase()
  const share = text.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (share) return (Number(share[1]) / Number(share[2])) * 100
  // A gate cell states its result in words, so it reads as a full pass or a full miss.
  if (text === "pass") return 100
  if (text === "fail") return 0
  if (text === "n/a" || text === "\u2014") return null
  // Units ride along in the cell: "150.3s", "-17.5%", "+1,044 tok".
  const match = text
    .replace(/\u2212/g, "-")
    .replace(/,/g, "")
    .match(/-?\d*\.?\d+/)
  return match ? Number(match[0]) : null
}

/** The name behind a glyph: a title with a leading emoji reads as its plain name. */
function plainTitle(title: string): string {
  // Every name match reads the ASCII name behind the glyph: "Caveman" from a title that starts with an emoji.
  return title.replace(/^[^A-Za-z0-9]+/, "").trim()
}

function columnIndex(table: BenchTable, name: string): number {
  return table.columns.findIndex((c) => c.toLowerCase() === name.toLowerCase())
}

/** Row names lose their markdown and their repeated prefix, so a bar label stays narrow. */
function shortName(row: string): string {
  return row
    .replace(/\u0060/g, "")
    .replace(/\(off\)/gi, "")
    .replace(/^Combo \+ Headroom \+ pstack/i, "All")
    .replace(/^Combo \+ Headroom/i, "Headroom")
    .replace(/^Combo \+ pstack/i, "pstack")
    .trim()
}

/** Every row of one shape, across all tables that carry the asked columns. */
function seriesFrom(files: BenchFile[], titles: string[], column: string): Point[] {
  const out: Point[] = []
  for (const file of files) {
    for (const table of file.tables) {
      if (!titles.includes(table.title)) continue
      const at = columnIndex(table, column)
      if (at < 0) continue
      for (const row of table.rows) {
        if (/^base/i.test(row[0])) continue
        const value = cellNumber(row[at])
        if (value !== null) out.push({ name: shortName(row[0]), value })
      }
    }
  }
  return out
}

function signed(value: number, digits = 1): string {
  const n = value.toFixed(digits)
  return value > 0 ? "+" + n : n
}

function rank(points: Point[]): Point[] {
  return [...points].sort((a, b) => a.value - b.value)
}

const RADAR_CONFIG: ChartConfig = { pct: { label: "Pass rate", color: "var(--accent)" } }
const GAUGE_CONFIG: ChartConfig = { saved: { label: "Saved", color: "var(--accent)" } }

/** The report headline: an oversized numeral over its context, on a rule rather than in a tile. */
function Headline({
  label,
  value,
  unit,
  context,
  tone,
}: {
  label: string
  value: string
  unit?: string
  context: string
  tone?: "good" | "bad"
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-3.5 py-2.5">
      <p className="mono text-[10px] uppercase tracking-[0.16em] text-dim">{label}</p>
      <p
        className={cn(
          "font-display text-[clamp(1.9rem,3.4vw,2.9rem)] leading-[0.95] tracking-tight tabular-nums",
          tone === "good" && "text-accent",
          tone === "bad" && "text-severe",
        )}
      >
        {value}
        {unit && <span className="mono ml-0.5 align-top text-xs text-dim">{unit}</span>}
      </p>
      <p className="mono text-[11px] leading-relaxed text-dim">{context}</p>
    </div>
  )
}

/** A diverging bar around a centre line: the one shape a negative delta reads at a glance. */
function DivergingBars({
  points,
  unit,
  label,
  limit = 8,
}: {
  points: Point[]
  unit: string
  label: string
  limit?: number
}) {
  // The leaders first, so a tile stays a tile and never becomes a full report.
  const shown = [...points].sort((a, b) => a.value - b.value).slice(0, limit)
  const hidden = points.length - shown.length
  const peak = Math.max(1, ...shown.map((p) => Math.abs(p.value)))
  return (
    <figure className="m-0 flex flex-col gap-1.5" role="img" aria-label={label}>
      <div className="flex items-center justify-between">
        <span className="mono text-[10px] uppercase tracking-[0.14em] text-dim">less</span>
        <span className="mono text-[10px] uppercase tracking-[0.14em] text-dim">more</span>
      </div>
      {shown.map((point) => {
        const share = Math.min(100, (Math.abs(point.value) / peak) * 100)
        const better = point.value < 0
        return (
          <div
            key={point.name}
            className="grid grid-cols-[minmax(0,7.5rem)_1fr_minmax(0,4rem)] items-center gap-2"
          >
            <span className="mono truncate text-[11px] text-dim">{point.name}</span>
            <span className="relative flex h-3.5 items-center">
              <span className="absolute inset-y-0 left-1/2 w-px bg-line" />
              <span
                className={cn(
                  "absolute h-2.5 rounded-[2px]",
                  better ? "bg-accent" : "bg-severe/70",
                )}
                style={
                  better
                    ? { right: "50%", width: share / 2 + "%" }
                    : { left: "50%", width: share / 2 + "%" }
                }
              />
            </span>
            <span className="mono text-right text-[11px] tabular-nums text-ink">
              {signed(point.value)}
              <span className="text-dim"> {unit}</span>
            </span>
          </div>
        )
      })}
      {hidden > 0 && (
        <p className="mono mt-1 text-[10px] text-dim">+{hidden} more in the mode cards</p>
      )}
    </figure>
  )
}

/** A ranked ladder: the order is the message, so figures line up on hairlines instead of bars. */
function Ladder({
  points,
  format,
  limit = 8,
}: {
  points: Point[]
  format: (value: number) => string
  limit?: number
}) {
  const all = rank(points)
  const ordered = limit > 0 ? all.slice(0, limit) : all
  const hidden = all.length - ordered.length
  const best = ordered[0]?.value ?? 0
  const worst = ordered.at(-1)?.value ?? 0
  return (
    <ol className="flex flex-col">
      {ordered.map((point, index) => (
        <li
          key={point.name}
          className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-baseline gap-2 border-b border-line/50 py-1.5 last:border-0"
        >
          <span className="mono text-[10px] tabular-nums text-dim">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="truncate text-xs text-ink">{point.name}</span>
          <span
            className={cn(
              "mono text-xs tabular-nums",
              point.value === best && "text-accent",
              point.value === worst && "text-severe",
            )}
          >
            {format(point.value)}
          </span>
        </li>
      ))}
      {hidden > 0 && (
        <li className="mono pt-1 text-[10px] text-dim">+{hidden} more in the mode cards</li>
      )}
    </ol>
  )
}

function CompressionGauge({ saved }: { saved: number }) {
  return (
    <figure className="m-0 flex flex-col items-center">
      <ChartContainer
        config={GAUGE_CONFIG}
        className="aspect-square h-[150px] w-full"
        role="img"
        aria-label="Payload compressed"
      >
        <RadialBarChart
          data={[{ name: "saved", saved }]}
          startAngle={210}
          endAngle={-30}
          innerRadius="72%"
          outerRadius="100%"
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} angleAxisId={0} />
          <RadialBar
            dataKey="saved"
            cornerRadius={6}
            fill="var(--color-saved)"
            background={{ fill: "var(--track)" }}
            isAnimationActive={false}
          />
        </RadialBarChart>
      </ChartContainer>
      <p className="-mt-12 text-center">
        <span className="mono block text-2xl font-bold tabular-nums text-ink">
          {saved.toFixed(1)}%
        </span>
        <span className="mono block text-[10px] uppercase tracking-[0.14em] text-dim">
          payload removed
        </span>
      </p>
    </figure>
  )
}

/** A cell over three digits gets its thousands separators: 10912 reads as 10,912. */
function withThousands(cell: string): string {
  const match = cell.match(/^([+-]?)(\d{4,})(\.\d+)?$/)
  if (!match) return cell
  const [, sign, whole, fraction] = match
  return sign + Number(whole).toLocaleString("en-US") + (fraction ?? "")
}

/** A report table: hairlines only, numerals right-aligned, first column read as the label. */
function ReportTable({ table }: { table: BenchTable }) {
  const numeric = table.columns.map((_, index) =>
    table.rows.every(
      (row) => index === 0 || cellNumber(row[index]) !== null || row[index] === "\u2014",
    ),
  )
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-line">
            {table.columns.map((column, index) => (
              <th
                key={column}
                className={cn(
                  "mono whitespace-nowrap py-1.5 pr-3 text-[10px] font-medium uppercase tracking-[0.12em] text-dim",
                  numeric[index] && index > 0 && "text-right",
                )}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr
              key={row[0] + "-" + rowIndex}
              className="border-b border-line/40 last:border-0 hover:bg-track/50"
            >
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={cn(
                    "whitespace-nowrap py-1.5 pr-3 text-xs",
                    cellIndex === 0 ? "font-medium text-ink" : "mono tabular-nums text-dim",
                    numeric[cellIndex] && cellIndex > 0 && "text-right",
                    cellIndex > 0 && /^-/.test(cell) && "text-accent",
                    cellIndex > 0 && /^\+/.test(cell) && "text-severe",
                  )}
                >
                  {cellIndex === 0 ? cell : withThousands(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Spread({ title, tables }: { title: string; tables: BenchTable[] }) {
  return (
    <div className="grid min-w-0 gap-3">
      {tables
        .filter((table) => table.rows.length > 0)
        .map((table, index) => (
          <div key={title + "-" + index} className="flex min-w-0 flex-col gap-2">
            <p className="mono text-[10px] uppercase tracking-[0.14em] text-dim">{table.title}</p>
            <ReportTable table={table} />
          </div>
        ))}
    </div>
  )
}

export function BenchmarksPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    fetch("/api/benchmarks")
      .then((res) => res.json() as Promise<Payload>)
      .then((body) => {
        if (live) setData(body)
      })
      .catch(() => {
        if (live) setFailed(true)
      })
    return () => {
      live = false
    }
  }, [])

  const files = data?.files ?? []
  const reply = useMemo(() => seriesFrom(files, ["Prose", "Code"], "\u0394%"), [files])
  const net = useMemo(() => seriesFrom(files, ["Prose", "Code"], "\u0394 Net"), [files])
  const agentic = useMemo(() => seriesFrom(files, ["Agentic"], "\u0394%"), [files])
  const wall = useMemo(() => seriesFrom(files, ["Agentic"], "Wall median"), [files])

  const bestReply = reply.reduce<Point | null>(
    (best, row) => (best === null || row.value < best.value ? row : best),
    null,
  )
  const bestAgentic = agentic.reduce<Point | null>(
    (best, row) => (best === null || row.value < best.value ? row : best),
    null,
  )
  const worstNet = net.reduce<Point | null>(
    (worst, row) => (worst === null || row.value > worst.value ? row : worst),
    null,
  )

  const compressed = useMemo(() => {
    for (const file of files) {
      for (const table of file.tables) {
        if (table.title !== "Compression") continue
        const at = columnIndex(table, "Saved %")
        const value = cellNumber(at >= 0 ? table.rows[0]?.[at] : undefined)
        if (value !== null) return value
      }
    }
    return null
  }, [files])

  /** The base case, read from the Base rows: every delta on this page is measured against it. */
  const baseline = useMemo(() => {
    const rows: Array<{ label: string; value: string }> = []
    const pick = (titles: string[], column: string) => {
      for (const file of files) {
        for (const table of file.tables) {
          if (!titles.includes(table.title)) continue
          const at = columnIndex(table, column)
          if (at < 0) continue
          const row = table.rows.find((cells) => /^base/i.test(cells[0]))
          if (row) return row[at]
        }
      }
      return null
    }
    const reply = pick(["Prose"], "Reply median")
    const total = pick(["Prose"], "Total median")
    const proseQuality = pick(["Prose"], "Quality")
    const codeQuality = pick(["Code"], "Quality")
    const agentic = pick(["Agentic"], "Total median")
    if (reply) rows.push({ label: "Reply tokens", value: reply })
    if (total) rows.push({ label: "Tokens per case", value: total })
    if (proseQuality) rows.push({ label: "Prose gate", value: proseQuality })
    if (codeQuality) rows.push({ label: "Code gate", value: codeQuality })
    if (agentic) rows.push({ label: "Agentic tokens", value: agentic })
    return rows
  }, [files])

  /** Transport figures, read from the tables that carry them: no hand-typed numbers. */
  const transport = useMemo(() => {
    const rows: Array<{ label: string; flow: string; rate: string; note: string }> = []
    for (const file of files) {
      for (const table of file.tables) {
        if (table.title === "Command output") {
          const at = ["Case", "Bytes in", "Bytes out", "Δ%", "Mean"].map((name) =>
            columnIndex(table, name),
          )
          for (const row of table.rows) {
            rows.push({
              label: row[at[0]] ?? "",
              flow:
                row[at[1]] && row[at[2]]
                  ? withThousands(row[at[1]]) + " → " + withThousands(row[at[2]])
                  : "—",
              rate: row[at[3]] ?? "",
              note: row[at[4]] ?? "",
            })
          }
        }
        if (table.title === "Compression") {
          const at = ["Payload", "Tokens before", "Tokens after", "Saved %", "Sentinel"].map(
            (name) => columnIndex(table, name),
          )
          for (const row of table.rows) {
            rows.push({
              label: row[at[0]] ?? "",
              flow:
                row[at[1]] && row[at[2]]
                  ? withThousands(row[at[1]]) + " → " + withThousands(row[at[2]])
                  : "—",
              rate: row[at[3]] ?? "",
              note: row[at[4]] ?? "",
            })
          }
        }
      }
    }
    // A row is one measurement. The combo files republish the Headroom rows under a shorter label,
    // so the key is the figure itself and the longer label wins; a row with no figures is dropped.
    const byFigure = new Map<string, { label: string; flow: string; rate: string; note: string }>()
    for (const row of rows) {
      if (!/[0-9]/.test(row.flow)) continue
      const key = row.flow + "|" + row.rate
      const held = byFigure.get(key)
      if (!held || row.label.length > held.label.length) byFigure.set(key, row)
    }
    return [...byFigure.values()]
  }, [files])

  /** Gate pass rate by mode family: one radar spoke per family, the mean of every gate it publishes. */
  const radar = useMemo(() => {
    const families = ["Caveman", "Ponytail", "pstack", "RTK", "Headroom"]
    const GATES = ["Quality", "Pass", "Fidelity", "Sentinel"]
    return families.map((family) => {
      const values: number[] = []
      for (const file of files) {
        if (!plainTitle(file.title).startsWith(family)) continue
        for (const table of file.tables) {
          for (const gate of GATES) {
            const at = columnIndex(table, gate)
            if (at < 0) continue
            for (const row of table.rows) {
              if (/^(base|control)/i.test(row[0])) continue
              const value = cellNumber(row[at])
              if (value !== null) values.push(value)
            }
          }
        }
      }
      const mean =
        values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
      return { source: family, pct: Math.round(mean) }
    })
  }, [files])

  const modes = files.filter((file) => !/^combo/i.test(plainTitle(file.title)))
  const stacks = files.filter((file) => /^combo/i.test(plainTitle(file.title)))

  return (
    <Page>
      <div className="flex flex-col gap-4">
        {/* Masthead: the title block, wide enough that the standfirst never wraps into a wall. */}
        <header className="flex flex-col gap-3 border-b border-line pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="mono text-[10px] uppercase tracking-[0.22em] text-dim">
              Developer surface / report
            </p>
            <Badge
              variant="outline"
              className="mono gap-1.5 border-line text-[10px] uppercase tracking-[0.12em] text-dim"
            >
              <Icon name="flask-conical" className="size-3" />
              {files.length} result files
            </Badge>
          </div>
          <h1 className="font-display text-2xl leading-tight tracking-tight">Benchmark</h1>
          <p className="mono max-w-[92ch] text-xs leading-relaxed text-dim">
            Every mode measured against a base case on the same prompts, then published per mode.
            These tables are read from docs/BENCH_*.md when the page loads, so a figure lives in one
            place. One model, five runs per prompt, and no bill savings claimed.
          </p>
          <div className="grid overflow-hidden rounded-xl border border-line bg-panel [&>*]:border-line [&>*:not(:first-child)]:border-t sm:grid-cols-2 sm:[&>*:nth-child(even)]:border-l sm:[&>*:nth-child(n+3)]:border-t lg:grid-cols-4 lg:[&>*]:border-t-0 lg:[&>*:not(:first-child)]:border-l">
            <Headline
              label="Best reply change"
              value={bestReply ? signed(bestReply.value) : "\u2014"}
              unit="%"
              context={
                bestReply ? bestReply.name + " against base, reply tokens only" : "no measured case"
              }
              tone={bestReply ? "good" : undefined}
            />
            <Headline
              label="Best agentic change"
              value={bestAgentic ? signed(bestAgentic.value) : "\u2014"}
              unit="%"
              context={bestAgentic ? bestAgentic.name + ", whole-session tokens" : "no agentic run"}
              tone={bestAgentic ? "good" : undefined}
            />
            <Headline
              label="Costliest session"
              value={worstNet ? "+" + Math.round(worstNet.value).toLocaleString() : "\u2014"}
              unit="tok"
              context={worstNet ? worstNet.name + ", prompt overhead included" : "no measured case"}
              tone={worstNet ? "bad" : undefined}
            />
            <Headline
              label="Payload compressed"
              value={compressed === null ? "\u2014" : compressed.toFixed(1)}
              unit="%"
              context="Headroom on a fixed log block, sentinel intact"
              tone={compressed === null ? undefined : "good"}
            />
          </div>
        </header>

        {failed ? (
          <EmptyState
            icon="flask-conical"
            title="No benchmark data"
            desc="The dashboard could not read docs/BENCH_*.md."
          />
        ) : !data ? (
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <>
            {/* One bento grid: tiles of different widths, every one sized by what it shows. */}
            <section className="columns-1 gap-3 sm:columns-2 lg:columns-3 [&>*]:mb-3 [&>*]:break-inside-avoid">
              <Card
                title="Baseline"
                icon="circle-dot"
                description="The base case every delta is measured against, read from its own rows."
              >
                <ul className="flex flex-col">
                  {baseline.map((row) => (
                    <li
                      key={row.label}
                      className="mono flex items-baseline justify-between border-b border-line/50 py-1.5 text-[11px] text-dim last:border-0"
                    >
                      <span>{row.label}</span>
                      <span className="tabular-nums text-ink">{withThousands(row.value)}</span>
                    </li>
                  ))}
                  {baseline.length === 0 && (
                    <li className="mono text-xs text-dim">No base rows published.</li>
                  )}
                </ul>
              </Card>
              <Card
                title="What the modes change"
                icon="trending-down"
                description="Reply tokens against the base case. A bar left of the centre line saves tokens, a bar right of it spends them."
              >
                <DivergingBars
                  points={reply}
                  unit="%"
                  label="Reply token change per case against the base case"
                />
              </Card>
              <Card
                title="Session cost ranking"
                icon="scale"
                description="Total tokens per case, prompt overhead included. First place is the cheapest."
              >
                <Ladder
                  points={net}
                  format={(v) =>
                    v > 0 ? "+" + Math.round(v).toLocaleString() : Math.round(v).toLocaleString()
                  }
                />
              </Card>
              <Card
                title="Agentic tokens"
                icon="cpu"
                description="Whole-session tokens on the fixture task, one to five runs per stack."
              >
                <DivergingBars points={agentic} unit="%" label="Agentic token change per stack" />
                <div className="mono mt-2 flex items-center justify-between border-t border-line pt-2 text-[10px] text-dim">
                  <span>{agentic.length} stacks ranked</span>
                  <span className="text-accent">
                    {bestAgentic ? signed(bestAgentic.value) + "% best" : "—"}
                  </span>
                </div>
              </Card>
              <Card
                title="Gate pass rate"
                icon="radar"
                description="Each spoke is a mode family: the mean gate pass rate across every case that family publishes."
              >
                <figure className="m-0">
                  <ChartContainer
                    config={RADAR_CONFIG}
                    className="mx-auto h-[192px] w-full"
                    role="img"
                    aria-label="Gate pass rate per mode family"
                  >
                    <RadarChart data={radar} outerRadius="72%">
                      <PolarGrid stroke="var(--line)" />
                      <PolarAngleAxis
                        dataKey="source"
                        tick={{ fill: "var(--dim)", fontSize: 11 }}
                      />
                      <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                      <Radar
                        dataKey="pct"
                        name="Pass rate"
                        stroke="var(--color-pct)"
                        fill="var(--color-pct)"
                        fillOpacity={0.32}
                        isAnimationActive={false}
                      />
                      <ChartTooltip content={<ChartTooltipContent />} />
                    </RadarChart>
                  </ChartContainer>
                  <figcaption className="mono flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-dim">
                    {radar.map((row) => (
                      <span key={row.source}>
                        {row.source} <span className="text-ink">{row.pct}%</span>
                      </span>
                    ))}
                  </figcaption>
                  <p className="mono mt-1 border-t border-line pt-2 text-[10px] leading-relaxed text-dim">
                    Reference: base scores 73% on prose and 87% on code. A family below base
                    publishes no saving.
                  </p>
                </figure>
              </Card>
              <Card
                title="Wall clock"
                icon="timer"
                description="Seconds gained or lost on the fixture task against the base arm."
              >
                {wall.length > 0 ? (
                  <Ladder points={wall} format={(v) => signed(v) + "s"} />
                ) : (
                  <p className="mono text-xs text-dim">No wall-time column published.</p>
                )}
              </Card>
              {compressed !== null && (
                <>
                  <Card
                    title="Compression"
                    icon="gauge"
                    description="Headroom on the fixed log payload, read once on a disposable proxy."
                  >
                    <CompressionGauge saved={compressed} />
                  </Card>
                  <Card
                    title="Transport"
                    icon="zap"
                    description="Command output and proxy figures, measured at the transport layer and independent of the chat model."
                  >
                    <ul className="flex flex-col">
                      {transport.map((row, index) => (
                        <li
                          key={row.label + "-" + index}
                          className="mono grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-3 border-b border-line/50 py-1.5 text-[11px] text-dim last:border-0"
                        >
                          <span className="truncate text-ink">{row.label}</span>
                          <span className="tabular-nums">{row.flow}</span>
                          <span className="w-14 text-right tabular-nums text-accent">
                            {row.rate}
                          </span>
                        </li>
                      ))}
                      {transport.length === 0 && (
                        <li className="mono text-xs text-dim">No transport table published.</li>
                      )}
                    </ul>
                  </Card>
                </>
              )}
            </section>

            {/* One spread per mode, then the stacks, each with its published tables. */}
            <section className="flex flex-col gap-3">
              <div className="flex items-end justify-between gap-3 border-b border-line pb-2">
                <h2 className="font-display text-xl tracking-tight">Modes</h2>
                <p className="mono text-[10px] uppercase tracking-[0.14em] text-dim">
                  {modes.length} files
                </p>
              </div>
              {modes.map((file, index) => (
                <Card
                  key={file.id}
                  title={file.title.trim()}
                  description={
                    (file.meta.Mode ?? file.meta.Stack ?? file.meta.Model ?? "") +
                    " · " +
                    file.tables.length +
                    " tables"
                  }
                  actions={
                    <span className="mono text-[10px] tabular-nums text-dim">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  }
                >
                  <Spread title={file.id} tables={file.tables} />
                </Card>
              ))}
            </section>

            {stacks.length > 0 && (
              <section className="flex flex-col gap-3">
                <div className="flex items-end justify-between gap-3 border-b border-line pb-2">
                  <h2 className="font-display text-xl tracking-tight">Stacks</h2>
                  <p className="mono text-[10px] uppercase tracking-[0.14em] text-dim">
                    {stacks.length} files
                  </p>
                </div>
                {stacks.map((file) => (
                  <Card
                    key={file.id}
                    title={file.title.trim()}
                    description={file.meta.Stack ?? file.meta.Mode ?? ""}
                  >
                    <Spread title={file.id} tables={file.tables} />
                  </Card>
                ))}
              </section>
            )}

            <section className="flex flex-col gap-3 border-t border-line pt-4">
              <h2 className="font-display text-xl tracking-tight">Findings</h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {files
                  .filter((file) => file.findings.length > 0)
                  .map((file) => (
                    <div key={file.id} className="flex flex-col gap-2">
                      <p className="mono text-[10px] uppercase tracking-[0.14em] text-dim">
                        {file.title}
                      </p>
                      <ul className="flex flex-col gap-2">
                        {file.findings.slice(0, 3).map((line) => (
                          <li
                            key={line.slice(0, 48)}
                            className="mono border-l border-line pl-2 text-[11px] leading-relaxed text-dim"
                          >
                            {line}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
              </div>
            </section>
          </>
        )}
      </div>
    </Page>
  )
}
