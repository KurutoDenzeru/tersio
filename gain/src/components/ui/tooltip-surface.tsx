"use client"

import * as React from "react"
import { cn } from "cn"

export const TooltipSurface = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div">
>(function TooltipSurface({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      data-slot="tooltip-surface"
      className={cn(
        "grid min-w-32 items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl",
        className,
      )}
      {...props}
    />
  )
})

export function TooltipRow({
  label,
  value,
  color,
  indicator = "dot",
  hideIndicator = false,
  className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  color?: string
  indicator?: "line" | "dot" | "dashed"
  hideIndicator?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground",
        indicator === "dot" && "items-center",
        className,
      )}
    >
      {!hideIndicator && (
        <div
          className={cn(
            "shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)",
            indicator === "dot" && "h-2.5 w-2.5",
            indicator === "line" && "w-1",
            indicator === "dashed" && "w-0 border-[1.5px] border-dashed bg-transparent",
          )}
          style={
            {
              "--color-bg": color,
              "--color-border": color,
            } as React.CSSProperties
          }
        />
      )}
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2 leading-none">
        <div className="min-w-0 text-muted-foreground">{label}</div>
        {value != null && (
          <div className="shrink-0 font-mono font-medium text-foreground tabular-nums">
            {value}
          </div>
        )}
      </div>
    </div>
  )
}
