// One coding agent as a row: logo, version, config path, availability.
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { HoverTip } from "../common";
import { Icon } from "../icon";

export interface AgentRowProps {
  name: string;
  version: string | null;
  binPath: string | null;
  dirPath: string | null;
  bin: string;
  docs: string;
  available: boolean;
  unavailable: boolean;
  logo: ReactNode;
}

export function AgentRow({ name, version, binPath, dirPath, bin, docs, available, unavailable, logo }: AgentRowProps) {
  const status = unavailable ? "Unavailable" : available ? "Available" : "Not detected on PATH";
  return (
    <a
      href={docs}
      target="_blank"
      rel="noreferrer"
      className="group flex min-w-0 items-center gap-3 py-3 transition-colors hover:bg-track/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
      aria-label={`Open ${name}`}
    >
      {/* text-ink keeps masked marks legible in both themes. */}
      <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-md bg-track p-1 text-ink transition-transform duration-500 ease-out group-hover:scale-105">
        {logo}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="truncate text-sm font-semibold">{name}</span>
          {version && <span className="mono text-xs whitespace-nowrap text-dim">{version}</span>}
        </div>
        <div className="mt-0.5 min-w-0 text-xs text-dim">
          {/* PATH binary as secondary, config directory first when known. */}
          {dirPath ? (
            <HoverTip content={dirPath}>
              <span className="mono block truncate">{dirPath}</span>
            </HoverTip>
          ) : binPath ? (
            <HoverTip content={binPath}>
              <span className="mono block truncate">{binPath}</span>
            </HoverTip>
          ) : available ? (
            <span>Available as {bin} on PATH.</span>
          ) : unavailable ? (
            <span>Health information is unavailable.</span>
          ) : (
            <span>Not detected on PATH as {bin}.</span>
          )}
        </div>
      </div>
      <Badge variant={available ? "secondary" : unavailable ? "destructive" : "outline"} className="ml-auto shrink-0 gap-1.5 px-2 py-0.5 text-xs whitespace-nowrap">
        <span className={`size-1.5 rounded-full ${available ? "bg-accent" : unavailable ? "bg-danger" : "bg-track"}`} />
        {status}
      </Badge>
      <Icon name="chevron-right" className="size-4 shrink-0 text-dim" />
    </a>
  );
}
