// The payload behind one span, fetched from the journal by id: a model's usage grid, a tool's args, or text.

import { useEffect, useState } from "react"
import { ProviderMark, VendorMark } from "@/components/brand"
import { Icon } from "@/components/icon"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { AgentRequestPayload, AgentTraceSpan } from "@/lib/data"
import { fmt, fmtSecs, hostOfSession, stampLocal } from "@/lib/format"

export interface SpanDrawerProps {
  sessionFile: string
  span: AgentTraceSpan | null
  /** The lane this span sits on: `Main`, or a subagent's own row. */
  track: string
  money: (v: number) => string
  onClose: () => void
}

/** The icon each span kind carries, so the drawer header reads at a glance. */
const KIND_ICON: Record<string, string> = {
  turn: "user",
  model: "sparkles",
  tool: "wrench",
  background: "settings",
}

function SectionLabel({ icon, children }: { icon?: string; children: React.ReactNode }) {
  return (
    <p className="mono flex items-center gap-1.5 text-[10px] tracking-[0.14em] text-dim uppercase">
      {icon && <Icon name={icon} className="size-3.5" />}
      {children}
    </p>
  )
}

/** One key and its value: the reference's own row, one line each. */
function Kv({
  label,
  children,
  mono,
}: {
  label: string
  children: React.ReactNode
  mono?: boolean
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-3 border-b border-line/60 py-1.5 last:border-0">
      <dt className="mono w-40 shrink-0 text-[11px] tracking-[0.06em] text-dim">{label}</dt>
      <dd
        className={`m-0 min-w-0 flex-1 text-right text-[12px] [overflow-wrap:break-word] ${mono ? "mono" : "tabular-nums"}`}
      >
        {children}
      </dd>
    </div>
  )
}

function Chip({
  children,
  tint,
  title,
}: {
  children: React.ReactNode
  tint?: string
  title?: string
}) {
  return (
    <span
      title={title}
      className="mono inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11px]"
      style={tint ? { color: tint } : undefined}
    >
      {children}
    </span>
  )
}

/** One JSON block behind a fold, with its size and one click to copy. */
function JsonFold({ title, data, copy }: { title: string; data: unknown; copy?: string }) {
  const [copied, setCopied] = useState(false)
  const body = data === null || data === undefined ? "" : JSON.stringify(data, null, 2)
  const text = copy ?? body
  return (
    <details className="group rounded-xl border border-line">
      <summary className="mono flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-[10px] tracking-[0.14em] text-dim uppercase hover:text-ink">
        <Icon
          name="chevron-right"
          className="size-3 shrink-0 transition-transform group-open:rotate-90"
        />
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {body && (
          <span className="mono shrink-0 text-[10px] text-dim">
            {(new TextEncoder().encode(body).length / 1024).toFixed(1)} KB
          </span>
        )}
        {text && (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault()
              void navigator.clipboard.writeText(text).then(
                () => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                },
                () => undefined,
              )
            }}
            aria-label={`Copy ${title}`}
            className="mono inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2 py-0.5 text-[10px] hover:border-accent hover:text-accent"
          >
            <Icon name={copied ? "check" : "copy"} className="size-3" />
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </summary>
      {body ? (
        <pre className="mono m-0 max-h-[420px] max-w-full overflow-auto border-t border-line bg-track/40 p-3 text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
          {body}
        </pre>
      ) : (
        <p className="mono m-0 border-t border-line px-3.5 py-2.5 text-[11px] text-dim">
          No payload recorded for this entry.
        </p>
      )}
    </details>
  )
}

/** Text blocks from a message's content, in order. */
function textBlocks(content: unknown): Array<{ kind: string; text: string }> {
  if (typeof content === "string") return [{ kind: "text", text: content }]
  if (!content || typeof content !== "object") return []
  const record = content as Record<string, unknown>
  // The payload is either the content array itself or a message that carries one.
  const parts = Array.isArray(record.content)
    ? record.content
    : Array.isArray(content)
      ? content
      : []
  if (!Array.isArray(parts)) return []
  const blocks: Array<{ kind: string; text: string }> = []
  for (const part of parts) {
    if (!part || typeof part !== "object") continue
    const block = part as Record<string, unknown>
    const type = String(block.type ?? "")
    // A tool call's arguments are the Args row, so they never repeat under Text.
    if (type === "toolCall") continue
    const text = block.text ?? block.thinking ?? block.result
    if (typeof text === "string" && text.trim()) blocks.push({ kind: type || "text", text })
  }
  return blocks
}

/** The call's own arguments, one line, for the tool's Args row. */
function callArgs(output: unknown): string {
  const message = (output ?? null) as Record<string, unknown> | null
  if (message) {
    for (const key of ["arguments", "input"]) {
      const value = message[key]
      if (typeof value === "string" && value.trim()) return value.replace(/\s+/g, " ").trim()
      if (value && typeof value === "object") {
        try {
          return JSON.stringify(value)
        } catch {
          /* fall through */
        }
      }
    }
    if (Array.isArray(message.command)) return message.command.map(String).join(" ")
    if (typeof message.command === "string" && message.command.trim()) return message.command
  }
  const parts = Array.isArray(message?.content)
    ? (message.content as Array<Record<string, unknown>>)
    : []
  for (const part of parts) {
    if (part?.type !== "toolCall") continue
    const args = part.arguments
    if (args === null || args === undefined) continue
    if (typeof args === "string") return args.replace(/\s+/g, " ").trim()
    const record = args as Record<string, unknown>
    for (const key of ["command", "path", "file", "pattern", "query", "url"]) {
      const value = record[key]
      if (typeof value === "string" && value.trim()) return value.replace(/\s+/g, " ").trim()
    }
    try {
      return JSON.stringify(args)
    } catch {
      return ""
    }
  }
  return ""
}

/** The drawer for the selected span. Renders nothing when no span is open. */
export function SpanDrawer({ sessionFile, span, track, money, onClose }: SpanDrawerProps) {
  const [payload, setPayload] = useState<AgentRequestPayload | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!span) {
      setPayload(null)
      return
    }
    let live = true
    setLoading(true)
    const url = `api/agent/entry?file=${encodeURIComponent(sessionFile)}&entry=${encodeURIComponent(span.entryId)}`
    fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .then((next: AgentRequestPayload | null) => {
        if (live) setPayload(next)
      })
      .catch(() => {
        if (live) setPayload(null)
      })
      .finally(() => {
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
  }, [span, sessionFile])

  useEffect(() => {
    if (!span) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [span, onClose])

  if (!span) return null
  const held = span.end - span.start
  const blocks = textBlocks(payload?.output)
  const message = (payload?.output ?? null) as Record<string, unknown> | null
  const usage = (message?.usage ?? {}) as Record<string, unknown>
  const cost = (usage.cost ?? {}) as Record<string, unknown>
  const input = Number(usage.input ?? 0)
  const output = Number(usage.output ?? 0)
  const cacheRead = Number(usage.cacheRead ?? 0)
  const cacheWrite = Number(usage.cacheWrite ?? 0)
  const total = Number(usage.totalTokens ?? input + output + cacheRead + cacheWrite)
  const ttft = Number(message?.ttft ?? 0)
  const stopReason = String(message?.stopReason ?? span.stopped)
  const agentState = payload?.agent
  const host = hostOfSession(sessionFile)
  const api = String((payload?.output as { api?: unknown } | null)?.api ?? "")
  const tint = span.isError ? "var(--danger)" : undefined
  const args = span.kind === "tool" ? callArgs(payload?.output) || span.detail : ""
  const isModel = span.kind === "model"
  const spanCost = span.costUsd || Number(cost.total ?? 0)

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent
        side="right"
        className="w-[560px]! max-w-[calc(100vw-2rem)]! gap-0 overflow-y-auto p-0"
        aria-describedby={undefined}
      >
        <SheetHeader className="border-b border-line">
          <div className="flex items-center gap-2.5">
            <Icon name={KIND_ICON[span.kind] ?? "settings"} className="size-4 shrink-0 text-dim" />
            <SheetTitle className="font-display min-w-0 flex-1 truncate pr-8 text-base tracking-tight">
              {span.kind === "turn" ? span.label : span.label}
            </SheetTitle>
          </div>
          <SheetDescription className="mono flex flex-wrap items-center gap-1.5 text-[11px] text-dim">
            <Chip title="Span kind">{span.kind}</Chip>
            {span.isError && (
              <Chip tint={tint}>
                <span className="size-1.5 rounded-full" style={{ background: tint }} />
                failed
              </Chip>
            )}
            <span className="truncate" title={sessionFile}>
              {host.label}
            </span>
          </SheetDescription>
        </SheetHeader>

        <div className="grid gap-5 p-4">
          <dl className="m-0 grid gap-0">
            <Kv label="Duration">{fmtSecs(held)}</Kv>
            <Kv label="Start">{stampLocal(span.start)}</Kv>
            <Kv label="Track" mono>
              {track}
            </Kv>
            {isModel && <Kv label="Tokens">{fmt(total)}</Kv>}
            {isModel && spanCost > 0 && <Kv label="Cost">{money(spanCost)}</Kv>}
            {isModel && <Kv label="TTFT">{ttft > 0 ? fmtSecs(ttft) : "n/a"}</Kv>}
            {isModel && (
              <Kv label="Model" mono>
                <span className="inline-flex items-center gap-1.5">
                  {span.model ? <VendorMark model={span.model} tiny /> : null}
                  {span.model || "not recorded"}
                </span>
              </Kv>
            )}
            {isModel && (
              <Kv label="Input / output / cached">
                {fmt(input)} / {fmt(output)} / {fmt(cacheRead)}
              </Kv>
            )}
            {isModel && (
              <Kv label="Provider" mono>
                <span className="inline-flex items-center gap-1.5">
                  {span.provider ? <ProviderMark provider={span.provider} tiny /> : null}
                  {span.provider || "not recorded"}
                </span>
              </Kv>
            )}
            {isModel && (
              <Kv label="Stop reason" mono>
                {stopReason}
              </Kv>
            )}
            {api && (
              <Kv label="API" mono>
                {api}
              </Kv>
            )}
            {isModel && (
              <Kv label="Thinking" mono>
                {agentState?.thinkingLevel ?? "not recorded"}
              </Kv>
            )}
            {isModel && (
              <Kv label="Mode" mono>
                {agentState?.mode ?? "not recorded"}
              </Kv>
            )}
            {isModel && (
              <Kv label="Fallback" mono>
                {agentState?.fallback === null || agentState?.fallback === undefined
                  ? "not recorded"
                  : agentState.fallback
                    ? "yes, resolved as a fallback"
                    : "no"}
              </Kv>
            )}
            {!isModel && (
              <Kv label="Span id" mono>
                {span.id}
              </Kv>
            )}
            {!isModel && (
              <Kv label="Entry id" mono>
                {span.entryId || "unknown entry"}
              </Kv>
            )}
          </dl>

          {args && (
            <section className="grid gap-2">
              <SectionLabel icon="terminal">Args</SectionLabel>
              <pre className="mono m-0 max-h-52 overflow-auto rounded-xl border border-line bg-track/40 p-3 text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                {args}
              </pre>
            </section>
          )}

          {blocks.length > 0 && (
            <section className="grid gap-2">
              <SectionLabel icon="text">Text</SectionLabel>
              {blocks.slice(0, 6).map((block, index) => (
                <pre
                  key={`${block.kind}-${index}`}
                  className="mono m-0 max-h-52 overflow-auto rounded-xl border border-line bg-track/40 p-3 text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]"
                >
                  {block.text.slice(0, 8000)}
                </pre>
              ))}
            </section>
          )}

          {!loading && blocks.length === 0 && !args && span.detail && (
            <section className="grid gap-2">
              <SectionLabel icon="text">Text</SectionLabel>
              <pre className="mono m-0 max-h-52 overflow-auto rounded-xl border border-line bg-track/40 p-3 text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                {span.detail}
              </pre>
            </section>
          )}

          {span.isError && (
            <div
              className="grid gap-2 rounded-xl border px-3.5 pt-3 pb-2"
              style={{ borderColor: "var(--danger-border)", background: "var(--danger-soft)" }}
            >
              <p
                className="mono m-0 text-[10px] tracking-[0.14em] uppercase"
                style={{ color: "var(--danger)" }}
              >
                Error
              </p>
              <p className="mono m-0 text-xs [overflow-wrap:anywhere]">
                {span.detail || "The host flagged this call as failed."}
              </p>
            </div>
          )}

          {loading && <p className="mono m-0 text-[11px] text-dim">Reading the journal entry…</p>}

          <section className="grid gap-2">
            <SectionLabel icon="braces">Payload</SectionLabel>
            <JsonFold title="Raw entry" data={payload?.entry} />
            <JsonFold title="Message" data={payload?.output} />
            <JsonFold
              title="Span"
              data={{
                id: span.id,
                entryId: span.entryId,
                kind: span.kind,
                label: span.label,
                tool: span.tool,
                model: span.model,
                provider: span.provider,
                tokens: span.tokens,
                costUsd: span.costUsd,
                isError: span.isError,
                stopped: span.stopped,
                start: new Date(span.start).toISOString(),
                end: new Date(span.end).toISOString(),
                durationMs: span.end - span.start,
                track,
              }}
            />
          </section>
        </div>
      </SheetContent>
    </Sheet>
  )
}
