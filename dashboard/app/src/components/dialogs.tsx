// Settings, share, and footer. Ports the settings dialog (General /
// Connection / Diagnosis / Data panes), the share dialog with usage
// profile card, and the footer in template.html + settings.js + share.js.
// Shadcn Dialog + Select carry the structure; the row language, danger
// zone, and share actions stay identical to the original.
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTheme } from "@/components/theme-provider";
import { fmt, fmtShort, relAge } from "@/lib/format";
import {
  fetchDoctor,
  fetchHealth,
  isFileExport,
  postDoctorFix,
  postDoctorSchedule,
  postReset,
} from "@/lib/data";
import type { DoctorReport, HealthReport, UsageReport } from "@/lib/data";
import { useToast } from "./toaster";
import { CurrencyPicker } from "./savings";
import { HoverTip } from "./common";
import { Icon } from "./icon";

type Pane = "general" | "connection" | "diagnosis" | "data";

function OmpLogo() {
  return (
    <svg viewBox="0 0 120 90" aria-hidden="true" className="size-full">
      <rect x="10" y="8" width="100" height="12" rx="2" fill="#fafafa" />
      <rect x="25" y="20" width="12" height="62" rx="2" fill="#fafafa" />
      <rect x="75" y="20" width="12" height="45" rx="2" fill="#fafafa" />
      <rect x="71" y="55" width="20" height="16" rx="3" fill="#f97316" />
      <rect x="76" y="59" width="3" height="8" rx="1" fill="#0d0d0d" />
      <rect x="82" y="59" width="3" height="8" rx="1" fill="#0d0d0d" />
      <circle cx="18" cy="14" r="2" fill="#f97316" opacity="0.8" />
      <circle cx="102" cy="14" r="2" fill="#f97316" opacity="0.8" />
    </svg>
  );
}

/**
 * Mark tile for the agents that have no logo of their own here. Uses the same
 * geometry as the OMP tile rather than inventing brand marks we do not ship.
 */
function AgentMark({ id, label }: { id: string; label: string }) {
  const initials = label
    .split(/[\s-]+/)
    .filter((w) => /[A-Za-z]/.test(w[0] ?? ""))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span aria-hidden className="text-[13px] leading-none font-semibold text-dim select-none">
      {initials || id.slice(0, 2).toUpperCase()}
    </span>
  );
}

// Agent brand marks, inlined as React so they can inherit `currentColor`.
//
// These were vendored SVGs loaded through <img>, which cannot inherit a CSS
// colour: the monochrome marks had to be baked to near-white for the dark tile
// and were therefore invisible on the light theme. Inlined, they follow the
// theme for free, and there is no separate asset to keep in sync with.
//
// Provenance, since a wrong mark is worse than none:
//   claude   -- Simple Icons (slug `claude`), brand orange, legible on both
//   cursor   -- Simple Icons (slug `cursor`)
//   opencode -- Simple Icons (slug `opencode`)
//   codex    -- OpenAI's ChatGPT mark via Wikimedia Commons, public domain,
//               artist OpenAI. Simple Icons no longer carries an `openai` slug.
//   pi       -- pi.dev's own press kit. Simple Icons' `pi` slug is Raspberry Pi.
// Anything without a verifiable mark falls back to a monogram.

function ClaudeMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="#D97757" role="img" aria-hidden="true" className={className}>
      <path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/>
    </svg>
  );
}

function CursorMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" role="img" aria-hidden="true" className={className}>
      <path d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23"/>
    </svg>
  );
}

function OpenCodeMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" role="img" aria-hidden="true" className={className}>
      <path d="M22 24H2V0h20zM17 4.8H7v14.4h10z"/>
    </svg>
  );
}

function CodexMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 320" fill="currentColor" role="img" aria-hidden="true" className={className}>
      <path d='m297.06 130.97c7.26-21.79 4.76-45.66-6.85-65.48-17.46-30.4-52.56-46.04-86.84-38.68-15.25-17.18-37.16-26.95-60.13-26.81-35.04-.08-66.13 22.48-76.91 55.82-22.51 4.61-41.94 18.7-53.31 38.67-17.59 30.32-13.58 68.54 9.92 94.54-7.26 21.79-4.76 45.66 6.85 65.48 17.46 30.4 52.56 46.04 86.84 38.68 15.24 17.18 37.16 26.95 60.13 26.8 35.06.09 66.16-22.49 76.94-55.86 22.51-4.61 41.94-18.7 53.31-38.67 17.57-30.32 13.55-68.51-9.94-94.51zm-120.28 168.11c-14.03.02-27.62-4.89-38.39-13.88.49-.26 1.34-.73 1.89-1.07l63.72-36.8c3.26-1.85 5.26-5.32 5.24-9.07v-89.83l26.93 15.55c.29.14.48.42.52.74v74.39c-.04 33.08-26.83 59.9-59.91 59.97zm-128.84-55.03c-7.03-12.14-9.56-26.37-7.15-40.18.47.28 1.3.79 1.89 1.13l63.72 36.8c3.23 1.89 7.23 1.89 10.47 0l77.79-44.92v31.1c.02.32-.13.63-.38.83l-64.41 37.19c-28.69 16.52-65.33 6.7-81.92-21.95zm-16.77-139.09c7-12.16 18.05-21.46 31.21-26.29 0 .55-.03 1.52-.03 2.2v73.61c-.02 3.74 1.98 7.21 5.23 9.06l77.79 44.91-26.93 15.55c-.27.18-.61.21-.91.08l-64.42-37.22c-28.63-16.58-38.45-53.21-21.95-81.89zm221.26 51.49-77.79-44.92 26.93-15.54c.27-.18.61-.21.91-.08l64.42 37.19c28.68 16.57 38.51 53.26 21.94 81.94-7.01 12.14-18.05 21.44-31.2 26.28v-75.81c.03-3.74-1.96-7.2-5.2-9.06zm26.8-40.34c-.47-.29-1.3-.79-1.89-1.13l-63.72-36.8c-3.23-1.89-7.23-1.89-10.47 0l-77.79 44.92v-31.1c-.02-.32.13-.63.38-.83l64.41-37.16c28.69-16.55 65.37-6.7 81.91 22 6.99 12.12 9.52 26.31 7.15 40.1zm-168.51 55.43-26.94-15.55c-.29-.14-.48-.42-.52-.74v-74.39c.02-33.12 26.89-59.96 60.01-59.94 14.01 0 27.57 4.92 38.34 13.88-.49.26-1.33.73-1.89 1.07l-63.72 36.8c-3.26 1.85-5.26 5.31-5.24 9.06l-.04 89.79zm14.63-31.54 34.65-20.01 34.65 20v40.01l-34.65 20-34.65-20z'/>
    </svg>
  );
}

function PiMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 800 800" fill="currentColor" role="img" aria-hidden="true" className={className}>
      <path fill="#F09082" d="M165.29 165.29H517.36V400H400V282.65H165.29Z"/>
      <path fill="#4D9ABF" d="M165.29 282.65H282.65V400H400V517.36H282.65V634.72H165.29Z"/>
      <path fill="#F1BE58" d="M517.36 400H634.72V634.72H517.36Z"/>
    </svg>
  );
}


/** Maps a host id to its brand mark. Anything unverified gets a monogram. */
const AGENT_MARKS: Record<string, (props: { className?: string }) => React.ReactElement> = {
  "claude-code": ClaudeMark,
  cursor: CursorMark,
  opencode: OpenCodeMark,
  codex: CodexMark,
  pi: PiMark,
};

function AgentBrandMark({ id, label }: { id: string; label: string }) {
  const Mark = AGENT_MARKS[id];
  // currentColor so the mark follows the theme; the tile already sets the text
  // colour the row uses, so no per-icon colour is needed.
  if (Mark) return <Mark className="size-full" />;
  return <AgentMark id={id} label={label} />;
}

type AgentRow = NonNullable<HealthReport["agents"]>[number];

const AGENT_STATUS: Record<
  "configured" | "selected" | "off",
  { label: string; variant: "success" | "destructive" | "outline"; dot: string }
> = {
  configured: { label: "Configured", variant: "success", dot: "bg-accent" },
  selected: { label: "Incomplete", variant: "destructive", dot: "bg-danger" },
  off: { label: "Not selected", variant: "outline", dot: "bg-track" },
};

/**
 * One agent row. Every supported agent uses this, so OMP is a row in the same
 * list rather than a separate card above it -- previously it was rendered
 * twice, once as "Available" and again as "Not selected".
 */
function AgentListRow({
  agent,
  href,
  unavailable,
}: {
  agent: AgentRow;
  href?: string;
  unavailable: boolean;
}) {
  const state = agent.configured ? "configured" : agent.selected ? "selected" : "off";
  const status = AGENT_STATUS[state];
  // The binary path is the most useful second line when we have it, since it
  // is what makes an installed host verifiable at a glance.
  const binPath = agent.binPath ?? null;
  const version = agent.version ?? null;
  const detail = binPath || agent.wiring;
  const Wrapper = href ? "a" : "div";
  return (
    <Wrapper
      {...(href ? { href, target: "_blank", rel: "noreferrer" } : {})}
      className="flex min-w-0 items-center gap-3 border-b border-line py-4 transition-colors hover:bg-track/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      aria-label={`${agent.label} — ${status.label}`}
    >
      <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-track p-1.5 text-ink">
        {agent.id === "omp" ? (
          <OmpLogo />
        ) : (
          <AgentBrandMark id={agent.id} label={agent.label} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold">{agent.label}</span>
          {version ? (
            <span className="mono text-xs text-dim">{version}</span>
          ) : (
            <span className="mono text-xs text-dim">{agent.id}</span>
          )}
        </div>
        <div className="mt-1 min-w-0 text-xs text-dim">
          {unavailable ? (
            <span>Health information is unavailable.</span>
          ) : binPath ? (
            <HoverTip content={binPath}>
              <span className="mono block truncate">{binPath}</span>
            </HoverTip>
          ) : (
            <span className="block truncate">
              {detail}
              {agent.selected && agent.missing > 0 ? ` · ${agent.missing} file(s) missing` : ""}
              {agent.selected && agent.missing === 0 ? " · up to date" : ""}
            </span>
          )}
        </div>
      </div>
      <Badge variant={status.variant} className="ml-auto shrink-0 gap-1.5">
        <span className={`size-1.5 rounded-full ${status.dot}`} />
        {unavailable ? "Unavailable" : status.label}
      </Badge>
      {href && <Icon name="chevron-right" className="shrink-0 text-dim" />}
    </Wrapper>
  );
}

function HealthPane() {
  const [health, setHealth] = useState<HealthReport | null | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const load = useCallback(() => {
    setRefreshing(true);
    void fetchHealth().then((report) => {
      setHealth(report);
      if (report) setCheckedAt(Date.now());
      setRefreshing(false);
    });
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const unavailable = health === null;
  const agents = health?.agents ?? [];
  // An older tersio build, or an exported snapshot from one, has no agents
  // payload. Fall back to the single OMP row so the pane is never empty.
  const rows: AgentRow[] = agents.length > 0
    ? agents
    : [{
      id: "omp",
      label: "Oh My Pi (OMP)",
      selected: false,
      configured: !!health?.omp,
      missing: 0,
      present: 0,
      wiring: "reference host · rtk extension · auto-rewrite",
      binPath: health?.ompPath ?? null,
      version: health?.omp ?? null,
    }];

  return (
    <div>
      <div className="flex items-start justify-between gap-3 border-b border-line pb-4">
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-semibold">Coding agents</p>
          <p className="mt-0.5 mb-0 text-xs text-dim">
            Every agent tersio supports. Configured means it is set up and every file is in place.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={load} disabled={refreshing} aria-label="Refresh coding agent status">
          {refreshing ? <Spinner /> : <Icon name="refresh-cw" />}
          Refresh
        </Button>
      </div>
      {health === undefined ? (
        <div className="flex items-center gap-4 border-b border-line py-4" role="status">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-track">
            <Spinner />
          </span>
          <div className="grid gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
      ) : (
        <div>
          {rows.map((agent) => (
            <AgentListRow
              key={agent.id}
              agent={agent}
              href={agent.id === "omp" ? "https://omp.sh" : undefined}
              unavailable={unavailable}
            />
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-dim" role="status">
        {checkedAt ? "Checked just now" : "Not checked yet"}{" "}
        <span className="text-dim">· change the selection with</span>{" "}
        <span className="mono">tersio install</span>
      </p>
    </div>
  );
}

function DoctorPane() {
  const toast = useToast();
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [fixing, setFixing] = useState(false);
  useEffect(() => {
    void fetchDoctor(false).then((d) => d && setReport(d));
  }, []);
  const groups = (() => {
    const seen: string[] = [];
    (report?.rows ?? []).forEach((r) => {
      if (!seen.includes(r.group || "Other")) seen.push(r.group || "Other");
    });
    return seen;
  })();
  const schedule = report?.schedule ?? "manual";
  const scheduleLabel = `${schedule[0].toUpperCase()}${schedule.slice(1)}`;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ScrollArea className="min-h-0 flex-1">
        <div className="pr-2.5 pb-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-semibold">Auto-check</p>
          <p className="mt-0.5 mb-0 text-xs text-dim">{report?.checkedAt ? `Checked ${relAge(report.checkedAt)}.` : "Never checked."}</p>
        </div>
        <Select
          value={schedule}
          onValueChange={(v) => {
            if (isFileExport()) return;
            void postDoctorSchedule(v as DoctorReport["schedule"]).then((d) => d && setReport(d));
          }}
        >
          <SelectTrigger size="sm" aria-label="Diagnosis schedule">
            <SelectValue>{scheduleLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {["manual", "daily", "weekly", "monthly"].map((s) => (
                <SelectItem key={s} value={s}>
                  {s[0].toUpperCase() + s.slice(1)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="mt-3.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-semibold">Scan</p>
          <p className="mt-0.5 mb-0 text-xs text-dim">Runs every check fresh and refreshes the list below.</p>
        </div>
        <button
          type="button"
          className="mono flex shrink-0 items-center gap-2 text-xs pl-2.5 pr-3 py-2 rounded-xl border border-line text-ink [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
          aria-label="Scan now"
          onClick={() => {
            void fetchDoctor(true).then((d) => {
              if (d) setReport(d);
              else if (isFileExport()) toast("Snapshot export", "Live scan needs tersio dashboard.", "scan-line");
            });
          }}
        >
          <Icon name="scan-line" className="size-3.5" />
          <span>Scan</span>
        </button>
      </div>
      <Table className="mt-4 border-y border-line">
        <TableCaption className="sr-only">Diagnosis check results</TableCaption>
        <TableHeader className="sticky top-0 z-10 bg-panel">
          <TableRow>
            <TableHead className="h-9 pl-3 text-[11px] tracking-[0.12em] text-dim uppercase">Check</TableHead>
            <TableHead className="h-9 w-28 pr-3 text-right text-[11px] tracking-[0.12em] text-dim uppercase">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {!report && Array.from({ length: 5 }).map((_, i) => (
            <TableRow key={i} aria-hidden="true">
              <TableCell className="py-3 pl-3">
                <Skeleton className="h-4 w-[42%]" />
                <Skeleton className="mt-1.5 h-3 w-[64%]" />
              </TableCell>
              <TableCell className="py-3 pr-3 text-right">
                <Skeleton className="ml-auto h-5 w-16 rounded-full" />
              </TableCell>
            </TableRow>
          ))}
          {groups.map((g) => [
            <TableRow key={`${g}-group`} className="hover:bg-transparent">
              <TableCell colSpan={2} className="bg-track/50 px-3 py-2 text-[10px] font-semibold tracking-[0.14em] text-dim uppercase">
                {g}
              </TableCell>
            </TableRow>,
            ...(report?.rows ?? [])
              .filter((r) => (r.group || "Other") === g)
              .map((r) => (
                <TableRow key={r.label}>
                  <TableCell className="py-3 pl-3">
                    <p className="m-0 font-semibold text-ink">{r.label}</p>
                    {r.detail && <p className="mono mt-0.5 mb-0 max-w-[480px] truncate text-xs text-dim">{r.detail}</p>}
                  </TableCell>
                  <TableCell className="py-3 pr-3 text-right">
                    <Badge variant={r.ok ? "success" : "destructive"}>
                      <span className={`size-1.5 rounded-full ${r.ok ? "bg-accent" : "bg-danger"}`} />
                      {r.ok ? "Pass" : "Fix"}
                    </Badge>
                  </TableCell>
                </TableRow>
              )),
          ])}
        </TableBody>
      </Table>
        </div>
      </ScrollArea>
      <div className="flex shrink-0 items-center justify-between gap-3 rounded-xl border border-warn-border bg-warn-soft px-3.5 py-3">
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-semibold">Fix issues</p>
          <p className="mt-0.5 mb-0 text-xs text-dim">Repairs extension files, config registrations, and the bundled ponytail copy. RTK binary and CLI update stay manual.</p>
        </div>
        <button
          type="button"
          className="mono flex shrink-0 items-center gap-2 text-xs pl-2.5 pr-3 py-2 rounded-xl border border-line text-ink [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
          aria-label="Fix diagnosed issues"
          disabled={fixing}
          onClick={() => {
            if (isFileExport()) {
              toast("Serve with tersio dashboard", "Fix runs on the live server only.", "wrench");
              return;
            }
            setFixing(true);
            void postDoctorFix()
              .then((d) => {
                if (!d) toast("Fix failed", "Could not reach the server.", "circle-alert");
                else if (d.failed.length) toast("Fix incomplete", d.failed.join(", "), "circle-alert");
                else toast("Fix done", "Repairs applied. Restart OMP.", "wrench");
                return fetchDoctor(true);
              })
              .then((d) => d && setReport(d))
              .finally(() => setFixing(false));
          }}
        >
          <Icon name="wrench" className="size-3.5" />
          <span>{fixing ? "Fixing…" : "Fix issues"}</span>
        </button>
      </div>
    </div>
  );
}

function DataPane({ data, onReload }: { data: UsageReport | null; onReload: () => void }) {
  const toast = useToast();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(id);
  }, [armed]);
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-semibold">Reload</p>
          <p className="mt-0.5 mb-0 text-xs text-dim">Re-read statistics from disk.</p>
        </div>
        <button
          type="button"
          className="mono flex shrink-0 items-center gap-2 text-xs pl-2.5 pr-3 py-2 rounded-xl border border-line text-ink [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
          aria-label="Reload data"
          onClick={onReload}
        >
          <Icon name="refresh-cw" className="size-3.5" />
          <span>Reload</span>
        </button>
      </div>
      <div className="mt-3 grid gap-2">
        <div className="min-w-0 overflow-hidden rounded-[10px] border border-line px-3 py-2">
          <p className="m-0 text-[13px] font-semibold">
            Usage DB <span className="text-[11px] font-normal text-dim">tersio-owned · local hosted</span>
          </p>
          <HoverTip content={data?.paths.usageDb ?? "–"}>
            <p className="mono mt-1 mb-0 truncate text-[11px] text-dim">
              {data?.paths.usageDb ?? "–"}
            </p>
          </HoverTip>
        </div>
      </div>
      <div className="mt-4 rounded-xl border border-danger-border bg-danger-soft p-3">
        <p className="m-0 mb-2.5 text-[11px] tracking-[0.14em] text-danger uppercase">Danger zone</p>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 text-[13px] font-semibold">Reset statistics</p>
            <p className="mt-0.5 mb-0 text-xs text-dim">Clears tersio statistics. Host-owned files stay intact. Click twice to confirm.</p>
          </div>
          <button
            type="button"
            className="mono flex shrink-0 items-center gap-2 text-xs pl-2.5 pr-3 py-2 rounded-xl border border-danger-border text-danger [transition:transform_.12s,background_.2s,box-shadow_.2s] hover:bg-accent-soft hover:shadow-[0_0_14px_var(--danger-border)] active:scale-[.96]"
            aria-label="Reset tersio statistics"
            disabled={busy}
            onClick={() => {
              if (isFileExport()) return;
              if (!armed) {
                setArmed(true);
                return;
              }
              setArmed(false);
              setBusy(true);
              void postReset()
                .then((ok) => {
                  if (ok) {
                    onReload();
                    toast("Statistics reset", "The usage statistics view now starts fresh. Transcripts and RTK history were never touched.", "rotate-ccw");
                  } else {
                    toast("Reset failed", "Could not reach the server. Try again.", "circle-alert");
                  }
                })
                .finally(() => setBusy(false));
            }}
          >
            <Icon name="rotate-ccw" className="size-3.5" />
            <span>{busy ? "Clearing…" : armed ? "Sure?" : "Reset"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

const PANES: Array<{ id: Pane; label: string; icon: string }> = [
  { id: "general", label: "General", icon: "settings" },
  { id: "connection", label: "Connection", icon: "plug" },
  { id: "diagnosis", label: "Diagnosis", icon: "stethoscope" },
  { id: "data", label: "Data", icon: "database" },
];

const TITLES: Record<Pane, string> = {
  general: "General",
  connection: "Connection",
  diagnosis: "Diagnosis",
  data: "Data",
};

const SETTINGS_SEARCH: Array<{ pane: Pane; label: string; terms: string }> = [
  { pane: "general", label: "Theme", terms: "general appearance theme light dark system color scheme mode" },
  { pane: "general", label: "Currency", terms: "currency display cost usd euro" },
  { pane: "connection", label: "Coding agents", terms: "connection provider coding agents agent oh my pi omp status path version refresh ready available" },
  { pane: "diagnosis", label: "Auto-check schedule", terms: "diagnosis system health auto-check schedule manual daily weekly monthly" },
  { pane: "diagnosis", label: "Scan", terms: "diagnosis scan check" },
  { pane: "diagnosis", label: "Fix issues", terms: "diagnosis repair fix issues" },
  { pane: "data", label: "Reload data", terms: "data reload refresh statistics disk database usage db path" },
  { pane: "data", label: "Reset statistics", terms: "data danger zone reset clear statistics" },
];

function HighlightMatch({ text, query, fullWhenAlias = false }: { text: string; query: string; fullWhenAlias?: boolean }) {
  if (!query) return text;
  const ranges = query
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const index = text.toLowerCase().indexOf(token);
      return index >= 0 ? { start: index, end: index + token.length } : null;
    })
    .filter((range): range is { start: number; end: number } => range !== null)
    .sort((a, b) => a.start - b.start);
  if (ranges.length === 0) return fullWhenAlias ? <mark className="rounded-[2px] bg-amber-300 px-0.5 text-inherit dark:bg-amber-300/40">{text}</mark> : text;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const [index, range] of ranges.entries()) {
    if (range.start < cursor) continue;
    if (range.start > cursor) parts.push(text.slice(cursor, range.start));
    parts.push(<mark key={`${range.start}-${index}`} className="rounded-[2px] bg-amber-300 px-0.5 text-inherit dark:bg-amber-300/40">{text.slice(range.start, range.end)}</mark>);
    cursor = range.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

export function SettingsDialog({
  open,
  onClose,
  data,
  cur,
  onCurrency,
  onReload,
}: {
  open: boolean;
  onClose: () => void;
  data: UsageReport | null;
  cur: string;
  onCurrency: (code: string) => void;
  onReload: () => void;
}) {
  const { theme, setTheme } = useTheme();
  const [pane, setPane] = useState<Pane>("general");
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
  const matchesSettings = (terms: string): boolean => queryTokens.every((token) => terms.includes(token));
  const matches = normalizedQuery
    ? SETTINGS_SEARCH.filter((item) => matchesSettings(item.terms))
    : [];
  const matchingPanes = new Set(matches.map((item) => item.pane));
  const shown = PANES.filter((p) => !normalizedQuery || matchingPanes.has(p.id));
  const updateQuery = (value: string): void => {
    setQuery(value);
    const next = value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const match = SETTINGS_SEARCH.find((item) => next.every((token) => item.terms.includes(token)));
    if (match) setPane(match.pane);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="block h-[min(88vh,800px)] max-h-[calc(100dvh-2rem)] w-[min(920px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] sm:max-w-[920px] gap-0 overflow-hidden rounded-2xl border border-line bg-panel p-0 text-ink shadow-[0_16px_48px_rgba(0,0,0,.35)]" showCloseButton={false} aria-describedby={undefined}>
        <div className="grid h-full min-h-0 max-h-full grid-cols-[240px_minmax(0,1fr)] max-sm:grid-cols-1">
          <aside className="flex min-h-0 flex-col gap-2.5 border-r border-line bg-panel px-3 py-4 max-sm:border-r-0 max-sm:border-b" aria-label="Settings sections">
            <div className="flex items-center gap-2 rounded-[10px] border border-line px-2.5 py-2 text-dim">
              <Icon name="search" className="size-4" />
              <input
                type="search"
                placeholder="Search settings"
                aria-label="Search settings"
                aria-controls="settings-search-results"
                autoComplete="off"
                value={query}
                onChange={(e) => updateQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") updateQuery("");
                }}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <button
                  type="button"
                  className="grid size-5 place-items-center rounded-md text-dim hover:bg-track hover:text-ink"
                  aria-label="Clear settings search"
                  onClick={() => updateQuery("")}
                >
                  <Icon name="x" className="size-3" />
                </button>
              )}
            </div>
            <nav id="settings-search-results" className="grid gap-0.5 overflow-y-auto" aria-label="Settings">
              {shown.map((p) => {
                const paneMatches = matches.filter((item) => item.pane === p.id);
                return (
                  <div key={p.id} className="contents">
                    <button type="button" className={`flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13px] text-ink hover:bg-track ${pane === p.id ? "bg-track font-semibold" : "bg-transparent font-normal"}`} onClick={() => setPane(p.id)}>
                      <Icon name={p.icon} className="size-4" />
                      <span><HighlightMatch text={p.label} query={normalizedQuery} /></span>
                      {normalizedQuery && <span className="ml-auto text-[10px] text-dim">{paneMatches.length} match{paneMatches.length === 1 ? "" : "es"}</span>}
                    </button>
                    {normalizedQuery && paneMatches.map((item) => (
                      <button
                        key={`${item.pane}-${item.label}`}
                        type="button"
                        className="ml-7 mr-2 rounded-lg px-2 py-1.5 text-left text-xs text-dim hover:bg-track hover:text-ink"
                        onClick={() => setPane(item.pane)}
                      >
                        <HighlightMatch text={item.label} query={normalizedQuery} fullWhenAlias />
                      </button>
                    ))}
                  </div>
                );
              })}
              {normalizedQuery && shown.length === 0 && (
                <p className="px-2.5 py-3 text-xs text-dim">No matching settings</p>
              )}
            </nav>
            <p className="mono mt-auto px-2.5 text-[11px] text-dim">tersio v{data?.version ?? "?"}</p>
          </aside>
          <div className="relative flex min-h-0 min-w-0 flex-col">
            <div className="flex items-center justify-between gap-3 px-5 pt-4">
              <DialogTitle className="m-0 text-base font-bold tracking-[-0.01em]">{TITLES[pane]}</DialogTitle>
              <button
                type="button"
                className="flex shrink-0 items-center p-2 rounded-xl border border-line text-ink [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
                aria-label="Close settings"
                onClick={onClose}
              >
                <Icon name="x" className="size-4" />
              </button>
            </div>
            <div className={`min-h-0 overscroll-contain px-5 pt-4 ${pane === "diagnosis" ? "flex flex-1 overflow-hidden pb-5" : "overflow-y-auto pb-5 [scrollbar-width:thin] [scrollbar-color:var(--line)_transparent]"}`}>
              {pane === "general" && (
                <section aria-label="General">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="m-0 text-[13px] font-semibold">Theme</p>
                      <p className="mt-0.5 mb-0 text-xs text-dim">Light, dark, or follow the system.</p>
                    </div>
                    <Tabs
                      value={theme}
                      onValueChange={(value) => {
                        if (value === "light" || value === "dark" || value === "system") setTheme(value);
                      }}
                      className="w-fit"
                    >
                      <TabsList className="rounded-[10px] border border-line bg-panel p-1">
                        {(
                          [
                            ["light", "sun", "Light"],
                            ["dark", "moon", "Dark"],
                            ["system", "monitor", "System"],
                          ] as const
                        ).map(([value, icon, label]) => (
                          <TabsTrigger key={value} value={value} aria-label={label}>
                            <Icon name={icon} />
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                  </div>
                  <div className="mt-3.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="m-0 text-[13px] font-semibold">Currency</p>
                      <p className="mt-0.5 mb-0 text-xs text-dim">Display currency for cost figures. Persists to tersio settings.</p>
                    </div>
                    <CurrencyPicker cur={cur} onPick={onCurrency} id="setCur" />
                  </div>
                </section>
              )}
              {pane === "connection" && (
                <section aria-label="Connection">
                  <HealthPane />
                </section>
              )}
              {pane === "diagnosis" && (
                <section className="min-h-0 flex-1" aria-label="Diagnosis">
                  <DoctorPane />
                </section>
              )}
              {pane === "data" && (
                <section aria-label="Data">
                  <DataPane data={data} onReload={onReload} />
                </section>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function streakOf(byDay: UsageReport["byDay"]): number {
  const key = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const cur = new Date();
  cur.setHours(0, 0, 0, 0);
  let k = key(cur);
  if (!byDay[k]) {
    cur.setDate(cur.getDate() - 1);
    k = key(cur);
    if (!byDay[k]) return 0;
  }
  let n = 0;
  while (byDay[k]) {
    n++;
    cur.setDate(cur.getDate() - 1);
    k = key(cur);
  }
  return n;
}

// Share targets. These are fixed, first-party hosts, never user input: only
// the share text is interpolated, and it is percent-encoded into a query
// parameter. Hoisted so the destination is a named constant rather than a URL
// assembled inline at the call site.
const SHARE_X = "https://x.com/intent/post";
const SHARE_REDDIT = "https://www.reddit.com/submit";
const SHARE_LINKEDIN = "https://www.linkedin.com/feed/";

/** Hosts we are willing to open a share window on. */
const SHARE_HOSTS = new Set(["x.com", "www.reddit.com", "www.linkedin.com"]);

/**
 * The single place a share window is opened.
 *
 * Every destination is a fixed first-party constant with the caller's text
 * percent-encoded into a query parameter, so nothing user-supplied can reach
 * the host or path. The allowlist makes that structural rather than a promise,
 * and `noopener` is applied here so no share target gets a handle on this page.
 */
function openShare(url: string, features = "noopener,noreferrer"): Window | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || !SHARE_HOSTS.has(parsed.hostname)) return null;
  return window.open(url, "_blank", features);
}

/**
 * Share targets built from a fixed base plus an encoded query. The only caller
 * input is percent-encoded into a parameter, so it can never become the host.
 */
function xShareUrl(text: string): string {
  return `${SHARE_X}?text=${encodeURIComponent(`${text} #Tersio`)}`;
}

function redditShareUrl(text: string): string {
  return `${SHARE_REDDIT}?title=${encodeURIComponent("My Tersio usage profile")}&text=${encodeURIComponent(text)}`;
}

export function ShareDialog({
  open,
  onClose,
  data,
  money,
}: {
  open: boolean;
  onClose: () => void;
  data: UsageReport | null;
  money: (v: number) => string;
}) {
  const toast = useToast();
  const brandDataUrlRef = useRef<string | null>(null);
  const imageBlobRef = useRef<Blob | null>(null);
  const imageBlobPromiseRef = useRef<Promise<Blob> | null>(null);
  const t = data?.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const total = t.input + t.output + t.cacheRead + t.cacheWrite;
  const runs = data?.messages ?? 0;
  const byModel = data?.byModel ?? {};
  const byDay = data?.byDay ?? {};
  const models = Object.keys(byModel).length;
  const saved = data?.savedUsd ?? 0;
  const cost = data?.usd ?? 0;
  let best = 0;
  Object.values(byDay).forEach((b) => {
    const v = b.input + b.output + b.cacheRead + b.cacheWrite;
    if (v > best) best = v;
  });
  const streak = streakOf(byDay);
  const text = `${fmtShort(total)} tokens / ${fmt(runs)} runs / ${fmtShort(runs ? Math.round(total / runs) : 0)} per run. Saved ${money(saved)} via cache. ${streak}-day streak. My AI spend, tracked with Tersio.`;

  const createPngBlob = (): Promise<Blob> => new Promise((resolve, reject) => {
    const img = new Image();
    const svg = new Blob([svgCard()], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svg);
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 1200;
        canvas.height = 850;
        const context = canvas.getContext("2d");
        if (!context) {
          URL.revokeObjectURL(url);
          reject(new Error("Canvas is unavailable"));
          return;
        }
        context.drawImage(img, 0, 0, 1200, 850);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (blob) resolve(blob);
          else reject(new Error("PNG render failed"));
        }, "image/png");
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Preview render failed"));
    };
    img.src = url;
  });

  const copyBlob = (blob: Blob): Promise<void> => {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      return Promise.reject(new Error("Image clipboard is unavailable"));
    }
    return navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  };

  const copyImage = (): Promise<void> => {
    const blob = imageBlobRef.current;
    if (blob) return copyBlob(blob);
    const pending = imageBlobPromiseRef.current;
    return pending ? pending.then(copyBlob) : Promise.reject(new Error("Preview image is not ready"));
  };

  useEffect(() => {
    imageBlobRef.current = null;
    imageBlobPromiseRef.current = null;
    if (!open) return undefined;
    const brandReady = brandDataUrlRef.current
      ? Promise.resolve(brandDataUrlRef.current)
      : fetch("brand.webp")
        .then((response) => response.blob())
        .then((blob) => new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error ?? new Error("Brand read failed"));
          reader.readAsDataURL(blob);
        }))
        .then((dataUrl) => {
          brandDataUrlRef.current = dataUrl;
          return dataUrl;
        });
    const pending = brandReady.then(() => createPngBlob()).then((blob) => {
      imageBlobRef.current = blob;
      return blob;
    }, (error: unknown) => {
      imageBlobPromiseRef.current = null;
      throw error;
    });
    imageBlobPromiseRef.current = pending;
    void pending.catch(() => undefined);
    return () => {
      imageBlobRef.current = null;
      imageBlobPromiseRef.current = null;
    };
  }, [open, data]);

  const copyText = (body: string, okMsg: string): void => {
    const done = (): void => toast("Copied", okMsg, "copy");
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(body).then(done, () => fallback());
    else fallback();
    function fallback(): void {
      try {
        const ta = document.createElement("textarea");
        ta.value = body;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        done();
      } catch {
        toast("Copy failed", "Select the text manually.", "circle-alert");
      }
    }
  };

  const shareImage = (openSocial: () => Window | null, network: string): void => {
    const socialWindow = openSocial();
    void copyImage().then(
      () => toast("Image copied", `Paste it into the ${network} composer.`, "copy"),
      () => {
        if (!socialWindow) copyText(text, "Image copy failed; share text copied instead.");
        else toast("Image copy failed", "Use Download and attach the PNG in the composer.", "circle-alert");
      },
    );
  };

  const copyPreviewImage = (): void => {
    void copyImage().then(
      () => toast("Image copied", "Usage preview copied as PNG.", "copy"),
      () => toast("Image copy failed", "Use Download instead.", "circle-alert"),
    );
  };

  // PNG export renders the profile card as SVG, then rasterizes it. Same
  // 1200x850 layout and theme rule as the original share.js svgCard().
  const svgCard = (): string => {
    const e = (x: string): string => x.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    let themeChoice: string | null = null;
    try {
      themeChoice = localStorage.getItem("tersio-theme");
    } catch {
      themeChoice = null;
    }
    const dark = themeChoice
      ? themeChoice === "dark"
      : !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const pal = dark
      ? { bg: "#09090b", ink: "#f4f4f5", dim: "#a1a1aa", accent: "#34d399" }
      : { bg: "#ffffff", ink: "#18181b", dim: "#52525b", accent: "#047857" };
    const hv = cells;
    const cw = 32;
    const gap = 9;
    const step = cw + gap;
    const gx = 64;
    const gy = 340;
    let grid = "";
    for (let gd = 0; gd < 7; gd++) {
      for (let gw = 0; gw < 26; gw++) {
        const gv = hv.vals[gw * 7 + gd] ?? 0;
        const gs = hv.max ? Math.sqrt(gv / hv.max) : 0;
        const go = gv ? (0.45 + 0.55 * gs).toFixed(2) : 0.13;
        grid += `<rect x="${gx + gw * step}" y="${gy + gd * step}" width="${cw}" height="${cw}" rx="8" fill="${pal.accent}" opacity="${go}"/>`;
      }
    }
    const streakTxt = `${streak}${streak === 1 ? " day" : " days"}`;
    const logo = brandDataUrlRef.current
      ? `<defs><clipPath id="brandClip"><rect x="1012" y="40" width="124" height="124" rx="62"/></clipPath></defs>` +
        `<image x="1012" y="40" width="124" height="124" clip-path="url(#brandClip)" href="${brandDataUrlRef.current}"/>`
      : "";
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="850" viewBox="0 0 1200 850">' +
      `<rect width="1200" height="850" rx="28" fill="${pal.bg}"/>` +
      `<path d="M1090 700 L980 800 h70 l-8 60 80 -96 h-70 l8 -64 z" fill="none" stroke="${pal.accent}" stroke-width="14" opacity="0.08" stroke-linejoin="round"/>` +
      `<text x="64" y="80" font-family="monospace" font-size="26" letter-spacing="6" fill="${pal.accent}">TERSIO · USAGE PROFILE</text>` +
      `<text x="60" y="250" font-family="monospace" font-size="130" font-weight="bold" fill="${pal.ink}">${e(`${fmtShort(total)} tokens`)}</text>` +
      `<text x="64" y="300" font-family="monospace" font-size="30" fill="${pal.dim}">across ${e(fmt(runs))} agent runs</text>` +
      grid +
      `<text x="64" y="680" font-family="monospace" font-size="24" letter-spacing="3" fill="${pal.dim}">AVG / RUN</text>` +
      `<text x="64" y="725" font-family="monospace" font-size="40" font-weight="bold" fill="${pal.ink}">${e(`${fmtShort(runs ? Math.round(total / runs) : 0)} / run`)}</text>` +
      `<text x="430" y="680" font-family="monospace" font-size="24" letter-spacing="3" fill="${pal.dim}">SAVED</text>` +
      `<text x="430" y="725" font-family="monospace" font-size="40" font-weight="bold" fill="${pal.ink}">${e(money(saved))}</text>` +
      `<text x="830" y="680" font-family="monospace" font-size="24" letter-spacing="3" fill="${pal.dim}">DAY STREAK</text>` +
      `<text x="830" y="725" font-family="monospace" font-size="40" font-weight="bold" fill="${pal.ink}">${e(streakTxt)}</text>` +
      `<text x="64" y="775" font-family="monospace" font-size="24" letter-spacing="3" fill="${pal.dim}">BEST DAY</text>` +
      `<text x="64" y="820" font-family="monospace" font-size="40" font-weight="bold" fill="${pal.ink}">${e(fmtShort(best))}</text>` +
      `<text x="430" y="775" font-family="monospace" font-size="24" letter-spacing="3" fill="${pal.dim}">EST. COST</text>` +
      `<text x="430" y="820" font-family="monospace" font-size="40" font-weight="bold" fill="${pal.ink}">${e(money(cost))}</text>` +
      `<text x="830" y="775" font-family="monospace" font-size="24" letter-spacing="3" fill="${pal.dim}">MODELS</text>` +
      `<text x="830" y="820" font-family="monospace" font-size="40" font-weight="bold" fill="${pal.ink}">${e(String(models))}</text>` +
      logo +
      "</svg>"
    );
  };

  const downloadPng = (): void => {
    void createPngBlob().then((blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = "tersio-usage.png";
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast("Saved", "Card downloaded as PNG.", "download");
    }, () => toast("Save failed", "Browser blocked the render.", "circle-alert"));
  };

  const cells = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 181);
    const vals: number[] = [];
    let max = 0;
    for (let i = 0; i < 182; i++) {
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const b = byDay[k];
      const v = b ? b.input + b.output + b.cacheRead + b.cacheWrite : 0;
      vals.push(v);
      if (v > max) max = v;
      d.setDate(d.getDate() + 1);
    }
    return { vals, max };
  })();
  const level = (v: number): string => {
    const s = cells.max ? Math.sqrt(v / cells.max) : 0;
    return !v ? "" : s >= 0.7 ? " l4" : s >= 0.45 ? " l3" : s >= 0.2 ? " l2" : " l1";
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="block w-[min(660px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] sm:max-w-[660px] gap-0 overflow-y-auto rounded-2xl border border-line bg-panel p-5 text-ink shadow-[0_16px_48px_rgba(0,0,0,.35)]" showCloseButton={false} aria-describedby={undefined}>
        <div className="pointer-events-none absolute top-0 left-1/2 h-[180px] w-[min(480px,90%)] -translate-x-1/2 -translate-y-[40%] bg-[radial-gradient(ellipse_at_center,var(--accent-soft)_0%,transparent_65%)]" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <DialogTitle className="m-0 text-base font-bold tracking-[-0.01em]">Share your usage</DialogTitle>
            <p className="mt-0.5 mb-0 text-xs text-dim">Copy the preview image or share your stats.</p>
          </div>
          <button
            type="button"
            className="flex shrink-0 items-center p-2 rounded-xl border border-line text-ink [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
            aria-label="Close share"
            onClick={onClose}
          >
            <Icon name="x" className="size-4" />
          </button>
        </div>
        <div className="relative mt-3.5 overflow-hidden rounded-xl border border-line bg-bg p-5">
          <span className="pointer-events-none absolute right-[-8px] bottom-[-14px] h-[120px] w-[120px] text-dim opacity-[.06] select-none [&_svg]:block [&_svg]:size-[110px]" aria-hidden="true">
            <Icon name="zap" className="size-4" />
          </span>
          <img src="brand.webp" alt="" width="44" height="44" className="absolute top-4 right-4 size-11 rounded-xl" aria-hidden="true" />
          <p className="mono m-0 text-[11px] tracking-[0.18em] text-accent uppercase">tersio · usage profile</p>
          <p className="mono m-0 mt-1.5 text-[clamp(2rem,5vw,3rem)] font-extrabold tracking-[-0.03em] tabular-nums">{fmtShort(total)} tokens</p>
          <p className="mono m-0 mt-1 text-xs text-dim">across {fmt(runs)} agent runs</p>
          <div className="mt-4 grid grid-cols-[repeat(26,minmax(0,1fr))] gap-[3px]" aria-hidden="true">
            {Array.from({ length: 7 }).flatMap((_, d) =>
              Array.from({ length: 26 }).map((__, w) => {
                const l = level(cells.vals[w * 7 + d] ?? 0);
                return <span key={`${d}-${w}`} className={`aspect-square w-full min-w-0 cursor-pointer rounded-[3px] ${l === " l4" ? "bg-cell-4" : l === " l3" ? "bg-cell-3" : l === " l2" ? "bg-cell-2" : l === " l1" ? "bg-cell-1" : "bg-cell-0"}`} />;
              }),
            )}
          </div>
          <div className="mono mt-3.5 grid grid-cols-3 gap-2">
            <div>
              <p className="m-0 text-[10px] tracking-[0.14em] text-dim uppercase">avg / run</p>
              <p className="m-0 mt-0.5 truncate text-[15px] font-bold tabular-nums">{fmtShort(runs ? Math.round(total / runs) : 0)} / run</p>
            </div>
            <div>
              <p className="m-0 text-[10px] tracking-[0.14em] text-dim uppercase">saved</p>
              <p className="m-0 mt-0.5 truncate text-[15px] font-bold tabular-nums">{money(saved)}</p>
            </div>
            <div>
              <p className="m-0 text-[10px] tracking-[0.14em] text-dim uppercase">day streak</p>
              <p className="m-0 mt-0.5 truncate text-[15px] font-bold tabular-nums">{streak + (streak === 1 ? " day" : " days")}</p>
            </div>
            <div>
              <p className="m-0 text-[10px] tracking-[0.14em] text-dim uppercase">best day</p>
              <p className="m-0 mt-0.5 truncate text-[15px] font-bold tabular-nums">{fmtShort(best)}</p>
            </div>
            <div>
              <p className="m-0 text-[10px] tracking-[0.14em] text-dim uppercase">est. cost</p>
              <p className="m-0 mt-0.5 truncate text-[15px] font-bold tabular-nums">{money(cost)}</p>
            </div>
            <div>
              <p className="m-0 text-[10px] tracking-[0.14em] text-dim uppercase">models</p>
              <p className="m-0 mt-0.5 truncate text-[15px] font-bold tabular-nums">{String(models)}</p>
            </div>
          </div>
        </div>
        <div className="mono text-xs mt-4 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-2">
            <HoverTip key="x" content="Share on X">
              <button
                type="button"
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-line bg-transparent px-[9px] py-[7px] text-xs text-ink hover:border-accent [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
                aria-label="Share on X"
                onClick={() => shareImage(
                  () => openShare(xShareUrl(text), "noopener,noreferrer,width=560,height=460"),
                  "X",
                )}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </button>
            </HoverTip>
            <HoverTip key="reddit" content="Share on Reddit">
            <button
              type="button"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-line bg-transparent px-[9px] py-[7px] text-xs text-ink hover:border-accent [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
              aria-label="Share on Reddit"
              onClick={() => shareImage(
                () => openShare(redditShareUrl(text)),
                "Reddit",
              )}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.688-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
              </svg>
            </button>
            </HoverTip>
            <HoverTip key="linkedin" content="Share on LinkedIn">
            <button
              type="button"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-line bg-transparent px-[9px] py-[7px] text-xs text-ink hover:border-accent [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
              aria-label="Share on LinkedIn"
              onClick={() => shareImage(
                () => openShare(SHARE_LINKEDIN),
                "LinkedIn",
              )}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
              </svg>
            </button>
            </HoverTip>
          </span>
          <span className="flex items-center gap-2 ml-auto">
            <button type="button" className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-line bg-transparent px-3 py-[7px] text-xs text-ink hover:border-accent [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]" aria-label="Copy usage preview as image" onClick={copyPreviewImage}>
              <Icon name="copy" className="size-3.5" />
              <span>Copy image</span>
            </button>
            <button type="button" className="inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-line bg-transparent px-3 py-[7px] text-xs text-ink hover:border-accent [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]" aria-label="Download card as PNG" onClick={downloadPng}>
              <Icon name="download" className="size-3.5" />
              <span>Download</span>
            </button>
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Footer() {
  return (
    <footer className="mono text-xs mt-12 pt-4 text-dim border-t border-line">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span>© 2026 Tersio. KurutoDenzeru. All rights reserved.</span>
        <span className="ml-auto flex items-center gap-1 text-ink">
          <a href="https://github.com/KurutoDenzeru/tersio" target="_blank" rel="noopener" aria-label="GitHub" className="grid size-8 place-items-center rounded-lg text-ink hover:text-accent [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]">
            <span className="size-4 bg-current" style={{ WebkitMaskImage: "url('https://cdn.jsdelivr.net/npm/simple-icons@v16/icons/github.svg')", WebkitMaskPosition: "center", WebkitMaskRepeat: "no-repeat", WebkitMaskSize: "contain" }} />
          </a>
          <a href="https://linkedin.com/in/kurtcalacday/" target="_blank" rel="noopener" aria-label="LinkedIn" className="grid size-8 place-items-center rounded-lg text-ink hover:text-accent [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96] [&_svg]:block [&_svg]:size-4">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
            </svg>
          </a>
          <a href="https://instagram.com/krtclcdy/" target="_blank" rel="noopener" aria-label="Instagram" className="grid size-8 place-items-center rounded-lg text-ink hover:text-accent [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]">
            <span className="size-4 bg-current" style={{ WebkitMaskImage: "url('https://cdn.jsdelivr.net/npm/simple-icons@v16/icons/instagram.svg')", WebkitMaskPosition: "center", WebkitMaskRepeat: "no-repeat", WebkitMaskSize: "contain" }} />
          </a>
        </span>
      </div>
    </footer>
  );
}
