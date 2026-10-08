// Session-start defaults. Each row saves on its own.
import { useEffect, useState } from "react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "../toaster";

export interface DefaultsPayload {
  comboDefault: string;
  cavemanDefault: string;
  rtkDefault: boolean;
  ponytailDefault: string;
}

const DEFAULT_ROWS_UI: Array<{ field: keyof DefaultsPayload; label: string; hint: string; options: Array<{ id: string; label: string }> }> = [
  {
    field: "comboDefault",
    label: "Combo preset",
    hint: "Sets caveman, RTK and Ponytail together.",
    options: [
      { id: "off", label: "Off" },
      { id: "medium", label: "Medium" },
      { id: "balanced", label: "Balanced (Recommended)" },
      { id: "max", label: "Max" },
    ],
  },
  {
    field: "cavemanDefault",
    label: "Caveman",
    hint: "Terse-reply mode for a new or resumed session.",
    options: [
      { id: "off", label: "Off" }, { id: "lite", label: "Lite" },
      { id: "full", label: "Full" }, { id: "ultra", label: "Ultra" },
      { id: "wenyan-lite", label: "Wenyan lite" }, { id: "wenyan-full", label: "Wenyan full" },
      { id: "wenyan-ultra", label: "Wenyan ultra" },
    ],
  },
  {
    field: "rtkDefault",
    label: "RTK",
    hint: "Rewrite eligible Bash calls through rtk.",
    options: [{ id: "on", label: "On" }, { id: "off", label: "Off" }],
  },
  {
    field: "ponytailDefault",
    label: "Ponytail",
    hint: "Lazy-code mode for a new or resumed session.",
    options: [
      { id: "off", label: "Off" }, { id: "lite", label: "Lite" },
      { id: "full", label: "Full" }, { id: "ultra", label: "Ultra" },
    ],
  },
];

// Session-start defaults mirror `tersio settings`; each row saves on its own.
export function DefaultModes() {
  const toast = useToast();
  const [current, setCurrent] = useState<DefaultsPayload>({
    comboDefault: "off", cavemanDefault: "off", rtkDefault: false, ponytailDefault: "off",
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Partial<DefaultsPayload> | null) => { if (alive && d) setCurrent((c) => ({ ...c, ...d })); })
      .catch(() => { /* keep the defaults; the rows still save */ })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  const save = (row: (typeof DEFAULT_ROWS_UI)[number], id: string): void => {
    const value: string | boolean = row.field === "rtkDefault" ? id === "on" : id;
    setCurrent((c) => ({ ...c, [row.field]: value }));
    void fetch("/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [row.field]: value }),
    })
      .then((r) => r.json())
      .then((d: { ok?: boolean; error?: string }) => {
        if (d?.ok) toast(`${row.label} saved`, `${id} applies to new sessions`, "check");
        else toast("Could not save", d?.error ?? "Unknown level", "circle-alert");
      })
      .catch(() => toast("Could not save", "The dashboard server did not answer.", "circle-alert"));
  };

  return (
    <div className="grid gap-6">
      {DEFAULT_ROWS_UI.map((row) => {
        const raw = current[row.field];
        const isRtk = row.field === "rtkDefault";
        const value = isRtk ? (raw ? "on" : "off") : String(raw ?? "off");
        // A live preset writes all three, so they are inert; Off makes them the only input.
        const presetOn = current.comboDefault !== "off";
        const locked = !loaded || (presetOn && row.field !== "comboDefault");
        if (isRtk) {
          return (
            <div key={row.field} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="m-0 text-[13px] font-semibold">{row.label}</p>
                <p className="mt-0.5 mb-0 text-xs text-dim">{row.hint}</p>
              </div>
              <Switch
                size="sm"
                checked={Boolean(raw)}
                onCheckedChange={(on: boolean) => save(row, on ? "on" : "off")}
                disabled={locked}
                aria-label={`${row.label} default`}
              />
            </div>
          );
        }
        return (
          <div key={row.field} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="m-0 text-[13px] font-semibold">{row.label}</p>
              <p className="mt-0.5 mb-0 text-xs text-dim">{row.hint}</p>
            </div>
            <Select value={value} onValueChange={(v) => save(row, v ?? "off")} disabled={locked}>
              <SelectTrigger size="sm" className="w-[132px] shrink-0" aria-label={`${row.label} default`}>
                {/* SelectValue needs children or it shows the raw value. */}
                <SelectValue placeholder="Off">{row.options.find((o) => o.id === value)?.label ?? "Off"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {row.options.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
}
