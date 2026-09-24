// Settings, share, and footer. Ports the settings dialog (General /
// Connection / Diagnosis / Data panes), the share dialog with usage
// profile card, and the footer in template.html + settings.js + share.js.
// Shadcn Dialog + Select carry the structure; the row language, danger
// zone, and share actions stay identical to the original.
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { Icon } from "./icon";

type Pane = "general" | "connection" | "diagnosis" | "data";

function HealthPane() {
  const [health, setHealth] = useState<HealthReport | null | undefined>(undefined);
  useEffect(() => {
    void fetchHealth().then(setHealth);
  }, []);
  if (health === undefined) {
    return (
      <div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skel-row" aria-hidden="true">
            <span className="skel-col">
              <span className="skel t" />
              <span className="skel s" />
            </span>
            <span className="skel v" />
          </div>
        ))}
      </div>
    );
  }
  const dot = (ok: boolean | null): React.ReactNode => (
    <span className={`set-dot${ok === true ? " ok" : ok === false ? " bad" : ""}`} />
  );
  // Same row pattern as General: name + hint left, status control right.
  return (
    <div>
      <p className="dlg-label">Connection</p>
      <div className="dlg-row">
        <div className="min-w-0">
          <p className="dlg-name">Status</p>
          <p className="dlg-hint">{health?.omp ? `wrapped with omp ${health.omp}` : "omp CLI not found"}</p>
        </div>
        <span className="mono text-xs flex shrink-0 items-center gap-2" style={{ color: "var(--dim)" }}>
          {dot(health ? !!health.omp : null)}
          {health ? (health.omp ? "Connected" : "Offline") : "unreachable"}
        </span>
      </div>
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
  return (
    <div>
      <p className="dlg-hint set-note">
        What works and what does not. Repair with <span className="mono">tersio doctor --fix</span>.
      </p>
      <div className="dlg-row">
        <div className="min-w-0">
          <p className="dlg-name">Auto-check</p>
          <p className="dlg-hint">{report?.checkedAt ? `Checked ${relAge(report.checkedAt)}.` : "Never checked."}</p>
        </div>
        <Select
          value={report?.schedule ?? "manual"}
          onValueChange={(v) => {
            if (isFileExport()) return;
            void postDoctorSchedule(v as DoctorReport["schedule"]).then((d) => d && setReport(d));
          }}
        >
          <SelectTrigger className="selbtn mono h-auto" aria-label="Diagnosis schedule">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["manual", "daily", "weekly", "monthly"].map((s) => (
              <SelectItem key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="dlg-row">
        <div className="min-w-0">
          <p className="dlg-name">Scan</p>
          <p className="dlg-hint">Runs every check fresh and refreshes the list below.</p>
        </div>
        <button
          type="button"
          className="btn-push mono flex shrink-0 items-center gap-2 text-xs pl-2.5 pr-3 py-2 rounded-xl"
          style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
          aria-label="Scan now"
          onClick={() => {
            void fetchDoctor(true).then((d) => {
              if (d) setReport(d);
              else if (isFileExport()) toast("Snapshot export", "Live scan needs tersio gain.", "scan-line");
            });
          }}
        >
          <Icon name="scan-line" className="size-3.5" />
          <span>Scan</span>
        </button>
      </div>
      <div className="set-list" style={{ maxHeight: 380, overflowY: "auto" }}>
        {!report && (
          <div>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skel-row" aria-hidden="true">
                <span className="skel-col">
                  <span className="skel t" />
                  <span className="skel s" />
                </span>
                <span className="skel v" />
              </div>
            ))}
          </div>
        )}
        {groups.map((g) => (
          <div key={g}>
            <p className="set-group">{g}</p>
            {(report?.rows ?? [])
              .filter((r) => (r.group || "Other") === g)
              .map((r) => (
                <div key={r.label} className="set-row">
                  <span>
                    <span className="k">{r.label}</span>
                    {r.detail && <p className="s mono">{r.detail}</p>}
                  </span>
                  <span className="v">
                    <span className={`set-dot${r.ok ? " ok" : " bad"}`} />
                    {r.ok ? "pass" : "fix"}
                  </span>
                </div>
              ))}
          </div>
        ))}
      </div>
      <div className="set-fixbox">
        <div className="min-w-0">
          <p className="dlg-name">Fix issues</p>
          <p className="dlg-hint">Repairs extension files, config registrations, and the bundled ponytail copy. RTK binary and CLI update stay manual.</p>
        </div>
        <button
          type="button"
          className="btn-push mono flex shrink-0 items-center gap-2 text-xs pl-2.5 pr-3 py-2 rounded-xl"
          style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
          aria-label="Fix diagnosed issues"
          disabled={fixing}
          onClick={() => {
            if (isFileExport()) {
              toast("Serve with tersio gain", "Fix runs on the live server only.", "wrench");
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
      <div className="dlg-row">
        <div className="min-w-0">
          <p className="dlg-name">Reload</p>
          <p className="dlg-hint">Re-read statistics from disk.</p>
        </div>
        <button
          type="button"
          className="btn-push mono flex shrink-0 items-center gap-2 text-xs pl-2.5 pr-3 py-2 rounded-xl"
          style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
          aria-label="Reload data"
          onClick={onReload}
        >
          <Icon name="refresh-cw" className="size-3.5" />
          <span>Reload</span>
        </button>
      </div>
      <div className="dlg-paths">
        <div className="dlg-path">
          <p className="dlg-name">
            Usage DB <span className="dlg-own">tersio-owned · local hosted</span>
          </p>
          <p className="mono dlg-file" title={data?.paths.usageDb ?? ""}>
            {data?.paths.usageDb ?? "–"}
          </p>
        </div>
      </div>
      <div className="dlg-danger">
        <p className="dlg-label">Danger zone</p>
        <div className="dlg-row">
          <div className="min-w-0">
            <p className="dlg-name">Reset statistics</p>
            <p className="dlg-hint">Clears tersio statistics. Host-owned files stay intact. Click twice to confirm.</p>
          </div>
          <button
            type="button"
            className="btn-push mono flex shrink-0 items-center gap-2 text-xs pl-2.5 pr-3 py-2 rounded-xl"
            style={{ border: "1px solid var(--danger-border)" }}
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
  const shown = PANES.filter((p) => !query || p.label.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="dlg setdlg max-w-none gap-0" showCloseButton={false} aria-describedby={undefined}>
        <div className="set-shell">
          <aside className="set-side" aria-label="Settings sections">
            <div className="set-search">
              <Icon name="search" className="size-4" />
              <input type="search" placeholder="Search settings" aria-label="Search settings" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <nav className="set-nav" aria-label="Settings">
              {shown.map((p) => (
                <button key={p.id} type="button" className={`set-navitem${pane === p.id ? " on" : ""}`} onClick={() => setPane(p.id)}>
                  <Icon name={p.icon} className="size-4" />
                  <span>{p.label}</span>
                </button>
              ))}
            </nav>
            <p className="mono set-ver">tersio v{data?.version ?? "?"}</p>
          </aside>
          <div className="set-main">
            <div className="set-head">
              <DialogTitle className="dlg-title">{TITLES[pane]}</DialogTitle>
              <button
                type="button"
                className="btn-push flex shrink-0 items-center p-2 rounded-xl"
                style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
                aria-label="Close settings"
                onClick={onClose}
              >
                <Icon name="x" className="size-4" />
              </button>
            </div>
            <div className="set-panes">
              {pane === "general" && (
                <section aria-label="General">
                  <p className="dlg-label">Appearance</p>
                  <div className="dlg-row">
                    <div className="min-w-0">
                      <p className="dlg-name">Theme</p>
                      <p className="dlg-hint">Light, dark, or follow the system.</p>
                    </div>
                    <ToggleGroup
                      value={[theme]}
                      onValueChange={(v) => {
                        const next = v[v.length - 1];
                        if (next === "light" || next === "dark" || next === "system") setTheme(next);
                      }}
                      className="seg mono text-xs p-1 rounded-[10px]"
                      style={{ border: "1px solid var(--line)", background: "var(--panel)" }}
                      aria-label="Theme"
                    >
                      {(
                        [
                          ["light", "sun", "Light"],
                          ["dark", "moon", "Dark"],
                          ["system", "monitor", "System"],
                        ] as const
                      ).map(([v, icon, label]) => (
                        <ToggleGroupItem key={v} value={v} className="px-2.5 py-1.5" aria-label={label} title={label}>
                          <Icon name={icon} className="size-4" />
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </div>
                  <div className="dlg-row">
                    <div className="min-w-0">
                      <p className="dlg-name">Currency</p>
                      <p className="dlg-hint">Display currency for cost figures. Persists to tersio settings.</p>
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
                <section aria-label="Diagnosis">
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
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="850" viewBox="0 0 1200 850">' +
      `<rect width="1200" height="850" rx="28" fill="${pal.bg}"/>` +
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
      "</svg>"
    );
  };

  const downloadPng = (): void => {
    try {
      const img = new Image();
      const svg = new Blob([svgCard()], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svg);
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = 1200;
          c.height = 850;
          c.getContext("2d")?.drawImage(img, 0, 0, 1200, 850);
          URL.revokeObjectURL(url);
          c.toBlob((b) => {
            if (!b) {
              toast("Save failed", "Browser blocked the render.", "circle-alert");
              return;
            }
            const a = document.createElement("a");
            a.download = "tersio-usage.png";
            a.href = URL.createObjectURL(b);
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 5000);
            toast("Saved", "Card downloaded as PNG.", "download");
          }, "image/png");
        } catch {
          toast("Save failed", "Browser blocked the render.", "circle-alert");
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        toast("Save failed", "Browser blocked the render.", "circle-alert");
      };
      img.src = url;
    } catch {
      toast("Save failed", "Browser blocked the render.", "circle-alert");
    }
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
      <DialogContent className="dlg shdlg max-w-none gap-0" showCloseButton={false} aria-describedby={undefined}>
        <div className="sh-glow" aria-hidden="true" />
        <div className="dlg-head">
          <div className="min-w-0">
            <DialogTitle className="dlg-title">Share your usage</DialogTitle>
            <p className="dlg-desc">Download the card or post your stats.</p>
          </div>
          <button
            type="button"
            className="btn-push flex shrink-0 items-center p-2 rounded-xl"
            style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
            aria-label="Close share"
            onClick={onClose}
          >
            <Icon name="x" className="size-4" />
          </button>
        </div>
        <div className="share-card sh-card">
          <span className="ghosticon" aria-hidden="true">
            <Icon name="zap" className="size-4" />
          </span>
          <img src="brand.webp" alt="" width="44" height="44" className="share-logo" aria-hidden="true" />
          <p className="mono share-kicker">tersio · usage profile</p>
          <p className="mono share-total">{fmtShort(total)} tokens</p>
          <p className="mono share-sub">across {fmt(runs)} agent runs</p>
          <div className="sh-heat" aria-hidden="true">
            {Array.from({ length: 7 }).flatMap((_, d) =>
              Array.from({ length: 26 }).map((__, w) => <span key={`${d}-${w}`} className={`cell${level(cells.vals[w * 7 + d] ?? 0)}`} />),
            )}
          </div>
          <div className="share-grid mono">
            <div>
              <p className="share-mini-k">avg / run</p>
              <p className="share-mini-v">{fmtShort(runs ? Math.round(total / runs) : 0)} / run</p>
            </div>
            <div>
              <p className="share-mini-k">saved</p>
              <p className="share-mini-v">{money(saved)}</p>
            </div>
            <div>
              <p className="share-mini-k">day streak</p>
              <p className="share-mini-v">{streak + (streak === 1 ? " day" : " days")}</p>
            </div>
            <div>
              <p className="share-mini-k">best day</p>
              <p className="share-mini-v">{fmtShort(best)}</p>
            </div>
            <div>
              <p className="share-mini-k">est. cost</p>
              <p className="share-mini-v">{money(cost)}</p>
            </div>
            <div>
              <p className="share-mini-k">models</p>
              <p className="share-mini-v">{String(models)}</p>
            </div>
          </div>
        </div>
        <div className="mono text-xs mt-4 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-2">
            <button
              type="button"
              className="btn-push share-btn share-icon"
              aria-label="Share on X"
              title="Share on X"
              onClick={() => window.open(`https://x.com/intent/post?text=${encodeURIComponent(`${text} #Tersio`)}`, "_blank", "noopener,width=560,height=460")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </button>
            <button
              type="button"
              className="btn-push share-btn share-icon"
              aria-label="Share on Reddit"
              title="Share on Reddit"
              onClick={() => window.open(`https://www.reddit.com/submit?title=${encodeURIComponent("My Tersio usage profile")}&text=${encodeURIComponent(text)}`, "_blank", "noopener")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.688-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z" />
              </svg>
            </button>
            <button
              type="button"
              className="btn-push share-btn share-icon"
              aria-label="Share on LinkedIn"
              title="Share on LinkedIn"
              onClick={() => {
                window.open("https://www.linkedin.com/feed/", "_blank", "noopener");
                copyText(text, "Image copied — paste it into the LinkedIn composer.");
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
              </svg>
            </button>
          </span>
          <span className="flex items-center gap-2 ml-auto">
            <button type="button" className="btn-push share-btn" aria-label="Copy share text" onClick={() => copyText(text, "Share text copied.")}>
              <Icon name="copy" className="size-3.5" />
              <span>Copy</span>
            </button>
            <button type="button" className="btn-push share-btn" aria-label="Download card as PNG" onClick={downloadPng}>
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
    <footer className="mono text-xs mt-12 pt-4" style={{ color: "var(--dim)", borderTop: "1px solid var(--line)" }}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span>© 2026 Tersio. KurutoDenzeru. All rights reserved.</span>
        <span className="ml-auto flex items-center gap-1" style={{ color: "var(--ink)" }}>
          <a href="https://github.com/KurutoDenzeru/tersio" target="_blank" rel="noopener" aria-label="GitHub" className="btn-push social grid size-8 place-items-center rounded-lg">
            <img height="16" width="16" src="https://cdn.jsdelivr.net/npm/simple-icons@v16/icons/github.svg" alt="GitHub" />
          </a>
          <a href="https://linkedin.com/in/kurtcalacday/" target="_blank" rel="noopener" aria-label="LinkedIn" className="btn-push social grid size-8 place-items-center rounded-lg">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
            </svg>
          </a>
          <a href="https://instagram.com/krtclcdy/" target="_blank" rel="noopener" aria-label="Instagram" className="btn-push social grid size-8 place-items-center rounded-lg">
            <img height="16" width="16" src="https://cdn.jsdelivr.net/npm/simple-icons@v16/icons/instagram.svg" alt="Instagram" />
          </a>
        </span>
      </div>
    </footer>
  );
}
