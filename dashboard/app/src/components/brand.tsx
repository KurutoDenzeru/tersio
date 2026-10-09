// Brand marks, all vendored: a table cell never fetches a logo, and the exported file stays self-contained.
// Two marks, two jobs: VendorMark names the model's author, ProviderMark the routing service that served it.
import { cn } from "cn";
import { providerColor, providerMeta, vendorOf } from "@/lib/format";
import { imageMark, maskMark } from "@/lib/marks";
import { STEALTH_MARK } from "@/lib/stealth-mark";
import { COGNITION_MARK } from "@/lib/cognition-mark";
import { Icon } from "./icon";

export function OpenAIGlyph({ className = "size-full" }: { className?: string }) {
  // currentColor follows theme ink; the tile keeps black-on-white.
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654 2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  );
}

// Alpha masking: a vendored Simple Icons path is opaque black, so luminance would erase it.
function maskedGlyph(src: string, color: string): React.CSSProperties {
  return {
    backgroundColor: color,
    WebkitMaskImage: `url("${src}")`,
    maskImage: `url("${src}")`,
    maskMode: "alpha",
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
    maskPosition: "center",
    WebkitMaskSize: "contain",
    maskSize: "contain",
  };
}

function MaskedGlyph({ className, src, color = "currentColor" }: { className: string; src: string; color?: string }) {
  return <span className={cn("block", className)} style={maskedGlyph(src, color)} />;
}

const TILE = "relative grid shrink-0 place-items-center overflow-hidden rounded-[12px] border border-line";
const TILE_SMALL = "size-8 rounded-[10px]";
/** One line of a dense table, where a 32px tile would inflate the row. */
const TILE_TINY = "size-[18px] rounded-[6px]";

/**
 * One tile, one mark. The chain is fixed: an image mark, then a mask, then a monogram, then a
 * generic glyph. A provider with no findable mark keeps its monogram, never another vendor's logo.
 */
function Mark({ slug, initial, color, small, tiny }: { slug: string; initial: string; color: string; small?: boolean; tiny?: boolean }) {
  const glyph = tiny ? "size-3" : small ? "size-[17px]" : "size-[22px]";
  const tile = cn(TILE, "size-[40px]", small && TILE_SMALL, tiny && TILE_TINY);
  if (slug === "openai") {
    return (
      <span className={cn(tile, "text-black")} style={{ background: color }} aria-hidden="true">
        <OpenAIGlyph className={cn("block", glyph)} />
      </span>
    );
  }
  if (slug === "stealth") {
    return (
      <span className={cn(tile, "bg-panel text-ink")} aria-hidden="true">
        <MaskedGlyph className={glyph} src={STEALTH_MARK} />
      </span>
    );
  }
  if (slug === "cognition") {
    return (
      <span className={cn(tile, "bg-panel text-ink")} aria-hidden="true">
        <MaskedGlyph className={cn("opacity-90", glyph)} src={COGNITION_MARK} />
      </span>
    );
  }
  const image = slug ? imageMark(slug) : null;
  if (image) {
    return (
      <span className={cn(tile, "bg-panel")} aria-hidden="true">
        <img src={image} alt="" loading="lazy" className={cn(glyph, "object-contain")} />
      </span>
    );
  }
  const mask = slug ? maskMark(slug) : null;
  if (mask) {
    return (
      <span className={cn(tile, "bg-panel text-ink")} aria-hidden="true">
        <MaskedGlyph className={glyph} src={mask} />
      </span>
    );
  }
  if (!initial) {
    return (
      <span className={cn(tile, "bg-transparent text-dim")} aria-hidden="true">
        <Icon name="bot" className={`grid ${glyph}`} />
      </span>
    );
  }
  return (
    <span className={tile} aria-hidden="true">
      <span className="absolute inset-0" style={{ background: color, opacity: 0.16 }} />
      <span className="mono relative text-[15px] font-bold leading-none" style={{ color }}>
        {initial}
      </span>
    </span>
  );
}

/** The mark for a provider id: its own brand when it has one, else a monogram of that id. */
export function ProviderMark({ provider, small, tiny }: { provider: string; small?: boolean; tiny?: boolean }) {
  return (
    <Mark
      slug={providerMeta(provider).slug}
      initial={(provider.match(/[a-z0-9]/i)?.[0] ?? "").toUpperCase()}
      color={providerColor(provider)}
      small={small}
      tiny={tiny}
    />
  );
}

/** The mark for a model's author, resolved from the model id. */
export function VendorMark({ model, small, tiny }: { model: string; small?: boolean; tiny?: boolean }) {
  const v = vendorOf(model);
  return (
    <Mark
      slug={v.slug}
      initial={v.slug ? "" : (v.name.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase()}
      color={v.color}
      small={small}
      tiny={tiny}
    />
  );
}

/** A bare masked mark, for a spot that is not a tile: the footer links. */
export function MarkGlyph({ slug, className }: { slug: string; className: string }) {
  const src = maskMark(slug);
  if (!src) return null;
  return <MaskedGlyph className={className} src={src} />;
}

export function BrandSilhouette({ model }: { model: string }) {
  const v = vendorOf(model);
  const cls =
    "pointer-events-none absolute -right-6 -bottom-6 size-[88px] select-none opacity-[.16] dark:opacity-[.2]";
  if (v.slug === "openai") {
    return (
      <span className={cn(cls, "grid place-items-center text-accent")} aria-hidden="true">
        <OpenAIGlyph className="block size-[72px]" />
      </span>
    );
  }
  if (v.slug === "stealth") {
    return (
      <span className={cn(cls, "grid place-items-center text-accent")} aria-hidden="true">
        <MaskedGlyph className="size-[72px]" src={STEALTH_MARK} />
      </span>
    );
  }
  if (v.slug === "cognition") {
    return (
      <span className={cn(cls, "grid place-items-center text-accent")} aria-hidden="true">
        <MaskedGlyph className="size-[72px]" src={COGNITION_MARK} />
      </span>
    );
  }
  const image = v.slug ? imageMark(v.slug) : null;
  if (image) {
    return (
      <span className={cn(cls, "grid place-items-center")} aria-hidden="true">
        <img src={image} alt="" loading="lazy" className="block size-[72px] rounded-full object-contain" />
      </span>
    );
  }
  const mask = v.slug ? maskMark(v.slug) : null;
  if (mask) {
    return (
      <span className={cn(cls, "grid place-items-center text-accent")} aria-hidden="true">
        <MaskedGlyph className="size-[72px]" src={mask} />
      </span>
    );
  }
  return (
    <span className={cn(cls, "grid place-items-center text-accent")} aria-hidden="true">
      <Icon name="bot" className="block size-[72px]" />
    </span>
  );
}
