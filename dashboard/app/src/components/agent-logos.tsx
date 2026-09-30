// Agent brand marks, shared by the settings agent list and the recent-requests
// Agent column so both render the same logo for the same host.
export function OmpLogo({ className = "size-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 90" aria-hidden="true" className={className}>
      <rect x="10" y="8" width="100" height="12" rx="2" fill="#fafafa" />
      <rect x="25" y="20" width="12" height="62" rx="2" fill="#fafafa" />
      <rect x="75" y="20" width="12" height="45" rx="2" fill="#fafafa" />
      <rect x="71" y="55" width="20" height="16" rx="3" fill="#f97316" />
      <rect x="76" y="59" width="3" height="8" rx="1" fill="#0d0d0d" />
      <rect x="82" y="59" width="3" height="8" rx="1" fill="#0d0d0d" />
      <circle cx="18" cy="14" r="2" fill="#f97316" opacity="0.8" />
      <circle cx="102" cy="14" r="2" fill="#f97316" opacity="0.8" />
    </svg>
  );
}

export function PiLogo({ className = "size-full" }: { className?: string }) {
  // The mark from pi.dev, cropped to its own bounds (165..635) so it fills the
  // tile the way the OMP tile does; the stock 800 viewBox has margins.
  return (
    <svg viewBox="165 165 470 470" aria-hidden="true" className={className}>
      <path fill="#F09082" d="M165.29 165.29H517.36V400H400V282.65H165.29Z" />
      <path fill="#4D9ABF" d="M165.29 282.65H282.65V400H400V517.36H282.65V634.72H165.29Z" />
      <path fill="#F1BE58" d="M517.36 400H634.72V634.72H517.36Z" />
    </svg>
  );
}

// No official Codex mark ships in this app, so rather than draw something that
// pretends to be one, fall back to a plain monogram tile.
function MonogramLogo({ label, className }: { label: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`mono grid size-full place-items-center rounded-[6px] bg-track text-[9px] font-bold tracking-tight text-dim ${className ?? ""}`}
    >
      {label}
    </span>
  );
}

/** The brand mark for a session host, sized to its container. */
export function AgentLogo({ host, className }: { host?: string; className?: string }) {
  if (host === "omp") return <OmpLogo className={className} />;
  if (host === "codex") return <MonogramLogo label="CX" className={className} />;
  return <PiLogo className={className} />;
}
