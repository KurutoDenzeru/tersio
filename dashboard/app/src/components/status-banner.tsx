// The status line from GET /status; a server without it, or a file:// export, leaves the viewport alone.
import { cn } from "cn"

// Full width, flush to the bottom, so the toaster's `bottom-4 right-4` stack grows upward over it; z-100 ties it.
const CLS =
  "pointer-events-none fixed inset-x-0 bottom-0 z-100 flex justify-center px-3 pb-2 " +
  "sm:px-4 sm:pb-3"

export function StatusBanner({ status }: { status: string | null }) {
  if (!status) return null

  const cls = cn(
    "mono m-0 max-w-full rounded-xl border border-line bg-panel px-3 py-1.5",
    "text-[11px] leading-tight tracking-tight text-ink shadow-[var(--shadow-xs)]",
    "break-words text-center sm:truncate sm:px-4 sm:py-2 sm:text-xs",
  )

  return (
    <div className={CLS} aria-live="polite" role="status">
      <p className={cls}>{status}</p>
    </div>
  )
}
