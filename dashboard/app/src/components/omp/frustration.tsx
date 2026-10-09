// Frustration in user messages: judged annoyance, its targets, and the model versions behind it.
import { useMemo, useState } from "react";
import { Card, Chart, DataTable, Legend, Page, PageHeader, Segmented, Stat, StatGrid } from "@/components/charts";
import type { Column, SeriesSpec } from "@/components/charts";
import { EmptyState } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { OMP_RANGE_LABEL } from "@/lib/data";
import type { OmpFrustration, OmpFrustrationModel, OmpStats } from "@/lib/data";
import { fmt, PALETTE, pct, vendorOf } from "@/lib/format";

/** Rows under this many messages are too noisy to compare; hidden unless asked for. */
const MIN_MESSAGES = 50;
/** Below this judged share a row is mostly classified by the regex fallback. */
const MIN_JUDGED_SHARE = 0.5;
/** Segmented-control value for "every model class". */
const ALL_CLASSES = "*";

/** Stack layers, bottom first. `annoyed` contains `atAssistant` contains `angry`, so stacking the differences draws each bar to the annoyed height. */
const LAYERS = [
  { key: "angry", label: "Angry at assistant" },
  { key: "assistant", label: "At assistant, not angry" },
  { key: "other", label: "Annoyed at other targets" },
] as const;
type Layer = (typeof LAYERS)[number]["key"];

/** One model version, with its class, family and revision derived from the raw id. */
interface FrustrationRow extends OmpFrustrationModel {
  key: string;
  label: string;
  models: string[];
  modelClass: string;
  family: string;
  revision: string;
}

/**
 * Split a model id into a vendor class, a version-free family name, and a revision. The id is all
 * Tersio has: omp's own catalog that named the class and family is not available here.
 */
function parseModel(model: string): { modelClass: string; family: string; revision: string } {
  const tail = model.split("/").pop() ?? model;
  const bare = tail.split(":")[0];
  const words: string[] = [];
  const versions: string[] = [];
  for (const token of bare.split(/[-_.]+/).filter(Boolean)) {
    if (/^\d+(?:\.\d+)*$/.test(token)) versions.push(token);
    else words.push(token[0].toUpperCase() + token.slice(1).toLowerCase());
  }
  return { modelClass: vendorOf(model).name, family: words.join(" "), revision: versions.join(".") };
}

/** Chart/filter identity of a model family: `class/family`. */
function familyKey(row: FrustrationRow): string {
  return `${row.modelClass}/${row.family}`;
}

function isMostlyRegex(row: FrustrationRow): boolean {
  return row.messages > 0 && row.judged / row.messages < MIN_JUDGED_SHARE;
}

function percent(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/** `part / whole` as a percentage string, en dash when there is nothing to divide. */
function rate(part: number, whole: number): string {
  return whole > 0 ? pct(part / whole) : "–";
}

/** FNV-1a: a stable preferred palette slot per family, independent of range. */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic family to palette color: each family starts at its hashed slot and probes forward past taken slots. */
function assignFamilyColors(rows: readonly FrustrationRow[]): Map<string, string> {
  const keys = [...new Set(rows.map(familyKey))].toSorted();
  const taken = new Set<number>();
  const colors = new Map<string, string>();
  for (const key of keys) {
    let slot = hashString(key) % PALETTE.length;
    for (let probe = 0; probe < PALETTE.length && taken.has(slot); probe++) slot = (slot + 1) % PALETTE.length;
    taken.add(slot);
    colors.set(key, PALETTE[slot]);
  }
  return colors;
}

/** Shades of one family hue for the three stacked layers. */
function layerColor(hue: string, layer: Layer): string {
  if (layer === "angry") return `color-mix(in srgb, ${hue} 55%, var(--ink))`;
  if (layer === "other") return `color-mix(in srgb, ${hue} 32%, transparent)`;
  return hue;
}

/** The share of user messages in one stack layer, clamped so rounding cannot invert the stack. */
function layerShare(row: FrustrationRow, layer: Layer): number {
  const count = layer === "angry" ? row.angry : layer === "assistant" ? row.atAssistant - row.angry : row.annoyed - row.atAssistant;
  return percent(Math.max(0, count), row.messages);
}

function FrustrationSummary({ overall }: { overall: OmpFrustration }) {
  const regex = overall.messages - overall.judged;
  return (
    <StatGrid cols={5}>
      <Stat label="User messages" title="User messages with prose in range" value={fmt(overall.messages)} />
      <Stat
        label="Judge coverage"
        title="Messages with a stored judge verdict; the rest use regex signals"
        value={rate(overall.judged, overall.messages)}
        hint={`${fmt(overall.judged)} judged · ${fmt(regex)} regex`}
      />
      <Stat
        label="Annoyed"
        title="Messages annoyed at any target"
        value={rate(overall.annoyed, overall.messages)}
        hint={`${fmt(overall.annoyed)} messages`}
      />
      <Stat
        label="At assistant"
        title="Messages annoyed at the assistant"
        value={rate(overall.atAssistant, overall.messages)}
        hint={`${fmt(overall.atAssistant)} messages`}
      />
      <Stat
        label="Angry"
        title="Messages angry or hostile toward the assistant"
        value={rate(overall.angry, overall.messages)}
        hint={`${fmt(overall.angry)} messages`}
      />
    </StatGrid>
  );
}

function EncodingKey() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-dim">
      <span className="flex items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-[2px]" style={{ background: layerColor("var(--accent)", "angry") }} />
        Angry at assistant
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-[2px]" style={{ background: "var(--accent)" }} />
        At assistant
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-[2px]" style={{ background: layerColor("var(--accent)", "other") }} />
        Annoyed at other targets
      </span>
      <span>Hue = model family</span>
    </div>
  );
}

function FrustrationChart({ rows, familyColors }: { rows: FrustrationRow[]; familyColors: Map<string, string> }) {
  const { data, series } = useMemo(() => {
    const families = [...new Set(rows.map(familyKey))].toSorted();
    const specs: SeriesSpec[] = [];
    for (const layer of LAYERS) {
      for (const fam of families) {
        specs.push({
          key: `${layer.key}|${fam}`,
          label: layer.label,
          color: layerColor(familyColors.get(fam) ?? PALETTE[0], layer.key),
        });
      }
    }
    const built = rows.map((row, i) => {
      const rec: Record<string, number | string | null> = { i };
      for (const spec of specs) rec[spec.key] = 0;
      for (const layer of LAYERS) rec[`${layer.key}|${familyKey(row)}`] = layerShare(row, layer.key);
      return rec;
    });
    return { data: built, series: specs };
  }, [rows, familyColors]);

  if (rows.length === 0) {
    return (
      <EmptyState icon="circle-slash" title="No model versions match the filters" desc="Adjust the class, family or size filters." />
    );
  }

  return (
    <Chart
      data={data}
      series={series}
      xKey="i"
      stacked
      height={340}
      tick={(i) => rows[i]?.label ?? ""}
      label={(i) => rows[i]?.label ?? ""}
      valueFmt={(v) => `${v}%`}
      summary="Stacked bars show the share of user messages per model version: angry at the assistant, at the assistant, and annoyed at other targets. Each bar reaches the annoyed rate."
      ariaLabel="Annoyed share per model version"
    />
  );
}

interface FamilyOption {
  key: string;
  label: string;
}

function FrustrationContent({ f }: { f: OmpFrustration }) {
  const rows = useMemo<FrustrationRow[]>(
    () =>
      f.byModel.map((m) => {
        const parsed = parseModel(m.model);
        return {
          ...m,
          ...parsed,
          key: m.model,
          label: `${parsed.family} ${parsed.revision}`.trim(),
          models: [m.model],
        };
      }),
    [f.byModel],
  );

  const familyColors = useMemo(() => assignFamilyColors(rows), [rows]);
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [hiddenFamilies, setHiddenFamilies] = useState<Set<string>>(() => new Set());
  const [showSmall, setShowSmall] = useState(false);
  const [hideRegex, setHideRegex] = useState(false);

  const classes = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of rows) totals.set(row.modelClass, (totals.get(row.modelClass) ?? 0) + row.messages);
    return totals;
  }, [rows]);

  const defaultClass = useMemo(() => {
    let best = ALL_CLASSES;
    let bestMessages = -1;
    for (const [modelClass, messages] of classes) {
      if (messages > bestMessages) {
        best = modelClass;
        bestMessages = messages;
      }
    }
    return best;
  }, [classes]);

  const activeClass =
    selectedClass !== null && (selectedClass === ALL_CLASSES || classes.has(selectedClass)) ? selectedClass : defaultClass;

  const classOptions = useMemo(
    () => [{ value: ALL_CLASSES, label: "All" }, ...[...classes].map(([modelClass]) => ({ value: modelClass, label: modelClass }))],
    [classes],
  );

  const inClass = useMemo(
    () => (activeClass === ALL_CLASSES ? rows : rows.filter((row) => row.modelClass === activeClass)),
    [rows, activeClass],
  );

  const families = useMemo(() => {
    const byKey = new Map<string, FamilyOption>();
    for (const row of inClass) {
      const key = familyKey(row);
      if (byKey.has(key)) continue;
      const family = row.family || "unclassified";
      byKey.set(key, { key, label: activeClass === ALL_CLASSES ? `${row.modelClass} · ${family}` : family });
    }
    return [...byKey.values()];
  }, [inClass, activeClass]);

  const visibleFamilies = useMemo(() => inClass.filter((row) => !hiddenFamilies.has(familyKey(row))), [inClass, hiddenFamilies]);
  const smallCount = visibleFamilies.filter((row) => row.messages < MIN_MESSAGES).length;
  const regexCount = visibleFamilies.filter(isMostlyRegex).length;
  const shownRows = useMemo(
    () => visibleFamilies.filter((row) => (showSmall || row.messages >= MIN_MESSAGES) && !(hideRegex && isMostlyRegex(row))),
    [visibleFamilies, showSmall, hideRegex],
  );

  const toggleFamily = (key: string): void => {
    setHiddenFamilies((held) => {
      const next = new Set(held);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const legendItems: SeriesSpec[] = families.map((family) => ({
    key: family.key,
    label: family.label,
    color: familyColors.get(family.key) ?? PALETTE[0],
  }));
  const visibleKeys = new Set(families.filter((family) => !hiddenFamilies.has(family.key)).map((family) => family.key));

  const columns = useMemo<Array<Column<FrustrationRow>>>(
    () => [
      {
        key: "model",
        header: "Model",
        sort: (row) => row.label,
        render: (row) => (
          <span className="flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-[2px]" style={{ background: familyColors.get(familyKey(row)) ?? PALETTE[0] }} />
            <span className="truncate">{row.label}</span>
          </span>
        ),
      },
      {
        key: "ids",
        header: "Model IDs",
        render: (row) => (
          <span className="mono block max-w-[220px] truncate text-[11px] text-dim" title={row.models.join(", ")}>
            {row.models.join(", ")}
          </span>
        ),
      },
      {
        key: "messages",
        header: "Messages",
        align: "right",
        sort: (row) => row.messages,
        render: (row) => <span className="mono text-xs tabular-nums">{row.messages}</span>,
      },
      {
        key: "judged",
        header: "Judged",
        align: "right",
        sort: (row) => (row.messages > 0 ? row.judged / row.messages : 0),
        render: (row) =>
          isMostlyRegex(row) ? (
            <span className="flex items-center justify-end gap-1.5" title="Mostly regex fallback: rates come from regex signals">
              <Badge variant="outline" className="mono text-[10px] text-[var(--warn-border)]">
                regex
              </Badge>
              <span className="mono text-xs tabular-nums text-dim">{rate(row.judged, row.messages)}</span>
            </span>
          ) : (
            <span className="mono text-xs tabular-nums">{rate(row.judged, row.messages)}</span>
          ),
      },
      {
        key: "annoyed",
        header: "Annoyed",
        align: "right",
        sort: (row) => percent(row.annoyed, row.messages),
        render: (row) => (
          <span className="mono text-xs tabular-nums" title={`${row.annoyed} messages`}>
            {rate(row.annoyed, row.messages)}
          </span>
        ),
      },
      {
        key: "atAssistant",
        header: "At assistant",
        align: "right",
        sort: (row) => percent(row.atAssistant, row.messages),
        render: (row) => (
          <span className="mono text-xs tabular-nums" title={`${row.atAssistant} messages`}>
            {rate(row.atAssistant, row.messages)}
          </span>
        ),
      },
      {
        key: "angry",
        header: "Angry",
        align: "right",
        sort: (row) => percent(row.angry, row.messages),
        render: (row) => (
          <span
            className={row.angry > 0 ? "mono text-xs tabular-nums text-[var(--danger)]" : "mono text-xs tabular-nums"}
            title={`${row.angry} messages`}
          >
            {rate(row.angry, row.messages)}
          </span>
        ),
      },
    ],
    [familyColors],
  );

  if (rows.length === 0) {
    return (
      <Card index={2} title="Frustration by model version">
        <EmptyState icon="circle-slash" title="No user messages in this range" desc="Try a longer range." />
      </Card>
    );
  }

  return (
    <>
      <FrustrationSummary overall={f} />
      <Card
        index={1}
        title="Judge classification"
        description="Cached LLM verdicts replace the regex heuristics; unjudged messages fall back to regex signals."
      >
        <div className="flex flex-col gap-3">
          <StatGrid cols={3}>
            <Stat
              label="Judged by judge"
              value={fmt(f.judged)}
              hint={f.judge ? `Verdicts from ${f.judge}` : "No judge label recorded"}
            />
            <Stat
              label="Classified by regex"
              value={fmt(Math.max(0, f.messages - f.judged))}
              hint="Signals omp stored when it ingested the message"
            />
            <Stat
              label="Judge coverage"
              value={pct(f.messages > 0 ? f.judged / f.messages : 0)}
              hint={`${fmt(f.messages)} user messages in range`}
            />
          </StatGrid>
          <p className="mono m-0 text-[11px] leading-relaxed text-dim">
            Tersio reads the verdicts omp already stored. It never runs the judge, so nothing is written to the omp databases.
          </p>
        </div>
      </Card>
      <Card
        index={2}
        title="Frustration by model version"
        description="Share of user messages per model version. Each bar reaches the annoyed rate; the subsets aimed at the assistant stack inside it."
      >
        <div className="flex flex-col gap-3">
          <Segmented value={activeClass} options={classOptions} onChange={setSelectedClass} label="Model class" className="flex-wrap" />
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Legend items={legendItems} active={visibleKeys} onToggle={toggleFamily} />
            <span className="flex-1" />
            <label
              className="mono flex cursor-pointer items-center gap-1.5 text-[11px] text-dim"
              title={`Models with fewer than ${MIN_MESSAGES} messages have noisy rates`}
            >
              <input
                type="checkbox"
                className="accent-[var(--accent)]"
                checked={showSmall}
                onChange={(e) => setShowSmall(e.target.checked)}
              />
              {`Include < ${MIN_MESSAGES} messages${smallCount > 0 ? ` (${smallCount})` : ""}`}
            </label>
            <label
              className="mono flex cursor-pointer items-center gap-1.5 text-[11px] text-dim"
              title={`Hide models with under ${MIN_JUDGED_SHARE * 100}% judged messages (rates from regex signals)`}
            >
              <input
                type="checkbox"
                className="accent-[var(--accent)]"
                checked={hideRegex}
                onChange={(e) => setHideRegex(e.target.checked)}
              />
              {`Hide mostly regex${regexCount > 0 ? ` (${regexCount})` : ""}`}
            </label>
          </div>
          <EncodingKey />
          <FrustrationChart rows={shownRows} familyColors={familyColors} />
        </div>
      </Card>
      <Card
        index={3}
        title="Model versions"
        description="Rates are shares of user messages; rows follow the chart filters."
        flush
      >
        <DataTable
          columns={columns}
          rows={shownRows}
          rowKey={(row) => row.key}
          ariaLabel="Model versions"
          empty={<EmptyState icon="circle-slash" title="No model versions match the filters" desc="Adjust the class, family or size filters." />}
        />
      </Card>
    </>
  );
}

export function FrustrationPage({ omp }: { omp: OmpStats }) {
  const f = omp.frustration;
  return (
    <Page>
      <PageHeader
        title="Frustration"
        description={`How often your messages sound annoyed, per model version, in ${OMP_RANGE_LABEL[omp.range]}. Every verdict is one omp already stored.`}
      />
      {f ? (
        <FrustrationContent f={f} />
      ) : (
        <Card index={2} title="Frustration by model version">
          <EmptyState icon="frown" title="No frustration data" desc="This page fills in once omp has stored verdicts for your messages." />
        </Card>
      )}
    </Page>
  );
}
