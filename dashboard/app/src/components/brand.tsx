// Brand marks served, not vendored: a tile resolves its mark's URL, inlined once by the CLI export for offline use.
import { useState } from "react";
import { cn } from "cn";
import { MARK_BG, MARK_SCALE, contrastInk } from "../../../../extensions/shared/brand-marks.ts";
import { providerColor, providerMeta, vendorOf } from "@/lib/format";
import { imageMark, maskMark } from "@/lib/marks";
import { Icon } from "./icon";

export function OpenAIGlyph({ className = "size-full" }: { className?: string }) {
  // currentColor follows theme ink; the tile keeps black-on-white.
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654 2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  );
}

/** Codex's own mark, from @lobehub/icons (the OpenAI blossom with a terminal prompt).
 * OpenAI's knot is the parent brand, so the CLI's own mark is the one that reads as Codex. */
export function CodexGlyph({ className = "size-full" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z" />
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

// A proportional radius, 22% of the side, stays a rounded square at any size; an absolute one would read as a circle.
const TILE = "relative grid shrink-0 place-items-center overflow-hidden rounded-[22%] border border-line";
const TILE_SMALL = "size-9";
/** One line of a dense table, where a bigger tile would inflate the row. */
const TILE_TINY = "size-[21px]";
/** A wide table row: it scales with the row's own type, so a dense table keeps its mark small. */
const TILE_ROW = "h-[1.85em] w-[1.85em]";
/** The art's share of its tile. The remainder is breathing room, so no mark crowds its border. */
const MARK_INK = 0.78;

/** One tile, one mark: image, mask, monogram, glyph; no findable mark keeps the monogram, not a logo. */
function Mark({ slug, initial, color, small, tiny, row }: { slug: string; initial: string; color: string; small?: boolean; tiny?: boolean; row?: boolean }) {
  const [broken, setBroken] = useState(false);
  // Only a mark whose art overruns its own box scales back, so no tile crops the ink.
  const scale = slug ? (MARK_SCALE[slug] ?? 1) : 1;
  // One size class: the art's share of its tile, which is full bleed outside a table row.
  const glyph = cn("size-[var(--mark-ink)]", scale !== 1 && "scale-[var(--mark-scale)]");
  const tile = cn(TILE, "size-11", small && TILE_SMALL, tiny && TILE_TINY, row && TILE_ROW);
  const bg = slug ? MARK_BG[slug] : undefined;
  const fill = { background: bg, "--mark-scale": scale, "--mark-ink": `${MARK_INK * 100}%` } as React.CSSProperties;
  const surface = bg ? undefined : "bg-panel";
  const ink = bg ? contrastInk(bg) : "currentColor";
  if (slug === "openai") {
    return (
      <span className={cn(tile, "text-black")} style={fill} aria-hidden="true">
        <OpenAIGlyph className={cn("block", glyph)} />
      </span>
    );
  }
  if (slug === "codex") {
    // The same glyph the Quick start node draws, so the CLI reads the same in every table.
    return (
      <span className={cn(tile, "text-black")} style={fill} aria-hidden="true">
        <CodexGlyph className={cn("block", glyph)} />
      </span>
    );
  }
  const image = slug && !broken ? imageMark(slug) : null;
  if (image) {
    return (
      <span className={cn(tile, surface)} style={fill} aria-hidden="true">
        {/* A mark that never arrives falls back to the monogram rather than leaving an empty tile. */}
        <img src={image} alt="" loading="lazy" onError={() => setBroken(true)} className={cn(glyph, "object-contain")} />
      </span>
    );
  }
  const mask = slug && !broken ? maskMark(slug) : null;
  if (mask) {
    return (
      <span className={cn(tile, surface)} style={fill} aria-hidden="true">
        <MaskedGlyph className={glyph} src={mask} color={ink} />
      </span>
    );
  }
  if (!initial) {
    // A glyph fills its own box edge to edge, unlike a logo, so it takes a smaller share of the tile.
    return (
      <span className={cn(tile, "bg-transparent text-dim")} aria-hidden="true">
        <Icon name="bot" className="size-[58%]" />
      </span>
    );
  }
  return (
    <span className={tile} style={{ background: color }} aria-hidden="true">
      <span className="mono relative text-base font-bold leading-none" style={{ color: contrastInk(color) }}>
        {initial}
      </span>
    </span>
  );
}

/** The mark for a provider id: its own brand when it has one, else a monogram of that id. */
export function ProviderMark({ provider, small, tiny, row }: { provider: string; small?: boolean; tiny?: boolean; row?: boolean }) {
  return (
    <Mark
      slug={providerMeta(provider).slug}
      initial={(provider.match(/[a-z0-9]/i)?.[0] ?? "").toUpperCase()}
      color={providerColor(provider)}
      small={small}
      tiny={tiny}
      row={row}
    />
  );
}

/** The mark for a model's author, resolved from the model id. */
export function VendorMark({ model, small, tiny, row }: { model: string; small?: boolean; tiny?: boolean; row?: boolean }) {
  const v = vendorOf(model);
  return (
    <Mark
      slug={v.slug}
      initial={v.slug ? "" : (v.name.match(/[a-z0-9]/i)?.[0] ?? "?").toUpperCase()}
      color={v.color}
      small={small}
      tiny={tiny}
      row={row}
    />
  );
}

/** A bare masked mark, for a spot that is not a tile: the footer links.
 * `color` overrides the theme ink, for a mark whose own brand color is the point. */
export function MarkGlyph({ slug, className, color }: { slug: string; className: string; color?: string }) {
  const src = maskMark(slug);
  if (!src) return null;
  return <MaskedGlyph className={className} src={src} color={color} />;
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


/** LinkedIn ships no Simple Icons slug in the catalog, so its mark lives here. */
function LinkedInGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z" />
    </svg>
  );
}

/** The owner's own accounts, in one place: the rail footer and the About pane both render these. */
const SOCIALS: ReadonlyArray<{ label: string; href: string; slug?: string }> = [
  { label: "GitHub", href: "https://github.com/KurutoDenzeru/tersio", slug: "github" },
  { label: "LinkedIn", href: "https://linkedin.com/in/kurtcalacday/" },
  { label: "Instagram", href: "https://instagram.com/krtclcdy/", slug: "instagram" },
];

/** A row of mark buttons. The rail hides its row when collapsed; the About pane always shows it. */
export function SocialLinks({ className }: { className?: string }) {
  return (
    <span className={className}>
      {SOCIALS.map((social) => (
        <a
          key={social.label}
          href={social.href}
          target="_blank"
          rel="noopener"
          aria-label={social.label}
          title={social.label}
          className="grid size-6 place-items-center rounded-md hover:text-accent [transition:transform_.12s,background_.2s] hover:bg-accent-soft active:scale-[.96]"
        >
          {social.slug ? <MarkGlyph slug={social.slug} className="block size-3.5" /> : <LinkedInGlyph className="block size-3.5" />}
        </a>
      ))}
    </span>
  );
}
