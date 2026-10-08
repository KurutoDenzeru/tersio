// Connection pane: which coding agents this machine has.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { fetchHealth } from "@/lib/data";
import type { HealthReport } from "@/lib/data";
import { OmpLogo, OpencodeLogo, PiLogo } from "../agent-logos";
import { Icon } from "../icon";
import { AgentRow, type AgentRowProps } from "./agent-row";

export function HealthPane() {
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
  // Absent hosts still show their binary name and lookup path.
  const agents: AgentRowProps[] = [
    { name: "Oh My Pi", version: health?.omp ?? null, binPath: health?.ompPath ?? null, dirPath: health?.ompDir ?? null, bin: "omp", docs: "https://omp.sh", available: !!health?.omp, unavailable, logo: <OmpLogo className="size-5" /> },
    { name: "Pi", version: health?.pi ?? null, binPath: health?.piPath ?? null, dirPath: health?.piDir ?? null, bin: "pi", docs: "https://pi.dev", available: !!health?.pi, unavailable, logo: <PiLogo className="size-5" /> },
    { name: "OpenCode", version: health?.opencode ?? null, binPath: health?.opencodePath ?? null, dirPath: health?.opencodeDir ?? null, bin: "opencode", docs: "https://opencode.ai", available: !!health?.opencode, unavailable, logo: <OpencodeLogo className="size-5" /> },
  ];

  return (
    <div>
      <div className="flex items-start justify-between gap-3 border-b border-line pb-4">
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-semibold">Coding agents</p>
          <p className="mt-0.5 mb-0 text-xs text-dim">Manage AI agent CLIs installed on this computer.</p>
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
        <div className="divide-y divide-line">
          {agents.map((agent) => (
            <AgentRow key={agent.name} {...agent} />
          ))}
        </div>
      )}
      {checkedAt && (
        <p className="mt-2.5 text-xs text-dim" role="status">
          Checked just now
        </p>
      )}
    </div>
  );
}
