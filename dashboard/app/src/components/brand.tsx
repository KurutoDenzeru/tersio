// Vendor brandmark: inline glyphs for the marks that need a fixed colour, Simple Icons CDN for the rest, and a sparkles...
import { useState, type ComponentType } from "react";
import { cn } from "cn";
import { vendorOf } from "@/lib/format";
import { Icon } from "./icon";

// Marks that are inlined rather than fetched, keyed by Simple Icons slug.
const INLINE_GLYPHS: Record<string, ComponentType<{ className: string }>> = {
  openai: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="#000" aria-hidden="true">
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654 2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  ),
  // Simple Icons "X", which is also xAI's mark and what a Grok model means.
  x: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="#000" aria-hidden="true">
      <path d="M14.234 10.162 22.977 0h-2.072l-7.591 8.824L7.251 0H.258l9.168 13.343L.258 24H2.33l8.016-9.318L16.749 24h6.993zm-2.837 3.299-.929-1.329L3.076 1.56h3.182l5.965 8.532.929 1.329 7.754 11.09h-3.182z" />
    </svg>
  ),
  // Devin's own vector, served by devin.ai and inlined like the others.
  devin: ({ className }) => (
    <svg className={className} viewBox="0 0 425 425" fill="#000" aria-hidden="true">
      <path d="M70 159.333V91.3471C70 88.3592 71.594 85.5983 74.1816 84.1044L133.043 50.1205C135.631 48.6265 138.819 48.6265 141.407 50.1205L200.269 84.1044C202.856 85.5983 204.45 88.3592 204.45 91.3471V126.068C204.708 137.606 210.806 148.734 221.531 154.926C232.256 161.117 244.942 160.834 255.063 155.289L285.132 137.929C287.719 136.435 290.907 136.435 293.495 137.929L352.357 171.913C354.944 173.406 356.538 176.167 356.538 179.155V247.123C356.538 250.111 354.944 252.872 352.357 254.366L293.495 288.35C290.907 289.844 287.719 289.844 285.132 288.35L255.306 271.13C245.146 265.456 232.344 265.117 221.534 271.358C210.809 277.55 204.711 288.678 204.453 300.215V334.926C204.453 337.914 202.859 340.675 200.271 342.169L141.41 376.153C138.822 377.647 135.634 377.647 133.046 376.153L74.1845 342.169C71.5969 340.675 70.0028 337.914 70.0028 334.926V266.959C70.0029 263.971 71.5969 261.21 74.1845 259.716L133.046 225.732C135.634 224.238 138.822 224.238 141.41 225.732L171.547 243.132C181.656 248.638 194.306 248.906 205.005 242.729C215.815 236.488 221.922 225.231 222.088 213.595C221.83 202.057 215.732 189.737 205.008 183.545C194.283 177.353 181.597 177.636 171.476 183.181L141.269 200.72C138.67 202.229 135.461 202.228 132.864 200.716L74.1576 166.562C71.5835 165.065 70 162.311 70 159.333Z" />
    </svg>
  ),
};

export function BrandSilhouette({ model }: { model: string }) {
  const v = vendorOf(model);
  const cls = "pointer-events-none absolute -right-6 -bottom-6 size-[88px] select-none opacity-[.06] dark:opacity-[.08]";
  const Glyph = INLINE_GLYPHS[v.slug];
  if (Glyph) {
    return (
      <span className={cn(cls, "grid place-items-center")} aria-hidden="true">
        <Glyph className="block size-[72px]" />
      </span>
    );
  }
  if (!v.slug) {
    return (
      <span className={cn(cls, "text-dim")} aria-hidden="true">
        <Icon name="sparkles" className="block size-[72px]" />
      </span>
    );
  }
  return (
    <span className={cn(cls, "grid place-items-center")} aria-hidden="true">
      <img
        src={`https://cdn.simpleicons.org/${v.slug}/white`}
        alt=""
        loading="lazy"
        className="size-[72px] object-contain brightness-0 dark:brightness-100"
      />
    </span>
  );
}

export function Brandmark({ model, small }: { model: string; small?: boolean }) {
  const v = vendorOf(model);
  const [failed, setFailed] = useState(false);
  const glyph = small ? "size-3.5" : "size-[18px]";
  const cls = cn(
    "grid size-[34px] shrink-0 place-items-center rounded-[10px] text-white",
    small && "size-7 rounded-lg",
  );
  const Glyph = INLINE_GLYPHS[v.slug];
  if (Glyph) {
    return (
      // White tiles disappear into a light background without the dark-tile fill.
      <span className={cn(cls, "border border-line")} style={{ background: v.color }}>
        <Glyph className={`block ${glyph}`} />
      </span>
    );
  }
  if (!v.slug || failed) {
    return (
      <span
        className={cn(
          "grid size-[34px] shrink-0 place-items-center rounded-[10px] border border-line bg-transparent text-dim",
          small && "size-7 rounded-lg",
        )}
      >
        <Icon name="sparkles" className={`grid ${glyph}`} />
      </span>
    );
  }
  return (
    <span className={cls} style={{ background: v.color }}>
      <img
        src={`https://cdn.simpleicons.org/${v.slug}/white`}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className={glyph}
      />
      <Icon name="sparkles" className={`hidden ${glyph}`} />
    </span>
  );
}
