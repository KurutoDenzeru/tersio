// Bottom status banner: the one status string the CLI and dashboard share
// (extensions/shared/status.ts), fetched from GET /status via the shared poll
// in lib/data.ts. Renders nothing until a status arrives, so a server without
// the endpoint — or a file:// export — leaves the viewport unchanged.
import { cn } from "cn";

// Flush to the bottom edge, full width: the toaster's `bottom-4 right-4` stack
// grows upward from 16px above that edge, so a toast lands on top of the banner
// rather than beside it. z-100 ties the toaster deliberately — ToasterProvider
// renders its stack after `children`, so an equal z-index puts toasts on top.
// The sticky hero (z-50) never reaches the bottom of the viewport.
const CLS =
  "pointer-events-none fixed inset-x-0 bottom-0 z-100 flex justify-center px-3 pb-2 " +
  "sm:px-4 sm:pb-3";

export function StatusBanner({ status }: { status: string | null }) {
  if (!status) return null;

  const cls = cn(
    "mono m-0 max-w-full rounded-xl border border-line bg-panel px-3 py-1.5",
    "text-[11px] leading-tight tracking-tight text-ink shadow-[var(--shadow-xs)]",
    "break-words text-center sm:truncate sm:px-4 sm:py-2 sm:text-xs",
  );

  return (
    <div className={CLS} aria-live="polite" role="status">
      <p className={cls}>{status}</p>
    </div>
  );
}