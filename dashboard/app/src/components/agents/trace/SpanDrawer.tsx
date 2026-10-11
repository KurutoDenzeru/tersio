// The span drawer: the full payload behind one span, read on demand from the journal.
//
// A span carries a one line detail, so the drawer fetches the journal entry by id and shows what
// the row only named: the model's usage grid, the tool's arguments and result, or the prompt text.
// Brand marks stay, so a model span reads the same here as it does in the timeline and the tables.

import { useEffect, useState } from "react";
import { ProviderMark, VendorMark } from "@/components/brand";
import { Icon } from "@/components/icon";
import type { AgentRequestPayload } from "@/lib/data";
import { displayModel, fmt, fmtMs } from "@/lib/format";
import type { AgentTraceSpan } from "@/lib/data";

export interface SpanDrawerProps {
  sessionFile: string;
  span: AgentTraceSpan | null;
  money: (v: number) => string;
  onClose: () => void;
}

/** Text blocks from a message's content, in order. */
function textBlocks(content: unknown): Array<{ kind: string; text: string }> {
  if (typeof content === "string") return [{ kind: "text", text: content }];
  if (!content || typeof content !== "object") return [];
  const record = content as Record<string, unknown>;
  // The payload is either the content array itself or a message that carries one.
  const parts = Array.isArray(record.content) ? record.content : Array.isArray(content) ? content : [];
  if (!Array.isArray(parts)) return [];
  const blocks: Array<{ kind: string; text: string }> = [];
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const block = part as Record<string, unknown>;
    const type = String(block.type ?? "");
    const text = block.text ?? block.thinking ?? block.arguments ?? block.result;
    if (typeof text === "string" && text.trim()) blocks.push({ kind: type || "text", text });
  }
  return blocks;
}

/** One key value line in the drawer's metric list. */
function Metric({ label, value, mark }: { label: string; value: string; mark?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-3 text-[12px]">
      <span className="mono w-24 shrink-0 text-[10px] tracking-[0.1em] text-dim uppercase">{label}</span>
      <span className="mono flex min-w-0 items-center gap-1.5 truncate">
        {mark}
        {value}
      </span>
    </div>
  );
}

/** The drawer for the selected span. Renders nothing when no span is open. */
export function SpanDrawer({ sessionFile, span, money, onClose }: SpanDrawerProps) {
  const [payload, setPayload] = useState<AgentRequestPayload | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!span) {
      setPayload(null);
      return;
    }
    let live = true;
    setLoading(true);
    const url = `api/agent/entry?file=${encodeURIComponent(sessionFile)}&entry=${encodeURIComponent(span.entryId)}`;
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((next: AgentRequestPayload | null) => {
        if (live) setPayload(next);
      })
      .catch(() => {
        if (live) setPayload(null);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [span, sessionFile]);

  useEffect(() => {
    if (!span) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [span, onClose]);

  if (!span) return null;
  const held = span.end - span.start;
  const blocks = textBlocks(payload?.output);
  const usage = (payload?.output as { usage?: Record<string, unknown> } | null)?.usage ?? {};

  return (
    <aside className="fixed top-0 right-0 z-40 flex h-full w-full max-w-[420px] flex-col gap-3 overflow-auto border-l border-line bg-panel px-4 py-4 shadow-sm">
      <header className="flex items-start gap-2">
        <Icon
          name={span.kind === "turn" ? "user" : span.kind === "model" ? "sparkles" : span.kind === "tool" ? "wrench" : "settings"}
          className="mt-0.5 size-4 text-dim"
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-bold">{span.kind === "turn" ? "Prompt" : span.label}</h2>
          {span.model && (
            <p className="mono flex items-center gap-1.5 text-[11px] text-dim">
              <VendorMark model={span.model} tiny />
              {displayModel(span.model)}
              {span.provider ? <ProviderMark provider={span.provider} tiny /> : null}
            </p>
          )}
          {span.kind === "tool" && span.provider && !span.model && (
            <p className="mono flex items-center gap-1.5 text-[11px] text-dim">
              <ProviderMark provider={span.provider} tiny />
              {span.provider}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mono cursor-pointer rounded-lg border border-line px-2 py-1 text-[11px] text-dim hover:bg-track hover:text-ink"
        >
          Close
        </button>
      </header>

      <div className="flex flex-col gap-1.5">
        <Metric label="Kind" value={span.kind} />
        <Metric label="Held" value={held > 0 ? fmtMs(held) : "a point in time"} />
        <Metric label="Started" value={new Date(span.start).toLocaleString()} />
        {span.stopped !== "completed" && <Metric label="Stopped" value={span.stopped} />}
        {span.isError && <Metric label="Error" value="failed" />}
        {span.tokens > 0 && <Metric label="Tokens" value={fmt(span.tokens)} />}
        {span.costUsd > 0 && <Metric label="Cost" value={money(span.costUsd)} />}
        {span.tool && <Metric label="Tool" value={span.tool} />}
        {usage.totalTokens !== undefined && <Metric label="Total tokens" value={fmt(Number(usage.totalTokens ?? 0))} />}
      </div>

      {span.detail && (
        <section className="flex flex-col gap-1.5">
          <h3 className="mono text-[10px] tracking-[0.14em] text-dim uppercase">Text</h3>
          <p className="m-0 text-[12px] leading-relaxed whitespace-pre-wrap">{span.detail}</p>
        </section>
      )}

      {loading && <p className="mono text-[11px] text-dim">Reading the journal entry…</p>}
      {!loading && payload?.messageRole && (
        <section className="flex flex-col gap-1.5">
          <h3 className="mono text-[10px] tracking-[0.14em] text-dim uppercase">Payload</h3>
          {blocks.length === 0 ? (
            <p className="m-0 text-[12px] text-dim">This entry carries no message body.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {blocks.slice(0, 6).map((block, index) => (
                <pre
                  key={`${block.kind}-${index}`}
                  className="mono m-0 max-h-40 overflow-auto rounded-lg border border-line bg-track/40 p-2 text-[11px] leading-relaxed whitespace-pre-wrap"
                >
                  {block.text.slice(0, 4000)}
                </pre>
              ))}
            </div>
          )}
        </section>
      )}
    </aside>
  );
}
