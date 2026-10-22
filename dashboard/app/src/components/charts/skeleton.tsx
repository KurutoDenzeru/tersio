// Section-shaped placeholders: a page draws its own blocks while its snapshot is on the way.
import { cn } from "cn";
import { Card as CardShell, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { navItem } from "@/components/agents/nav";
import type { SectionId } from "@/components/agents/nav";
import { CARD_CHROME, Page, PageHeader, StatGrid } from "./stats";
import { ChartSkeleton } from "./controls";
import { TableSkeleton } from "./table";

/** The body a placeholder card stands in for. */
type Body = "chart" | "bars" | "table";

interface CardSpec {
  body: Body;
  /** Rows a table or bar-list body draws. */
  rows?: number;
}

/** One block of the page: a stat strip, or several cards sharing a `grid`. */
type Block = { strip: 2 | 3 | 4 | 5 | 6 | 7; sm?: boolean } | { cards: readonly CardSpec[]; grid?: string };

// The blocks of every page, in screen order. A page missing from this record fails to typecheck.
const LAYOUT: Record<SectionId, readonly Block[]> = {
  overview: [
    { strip: 5 },
    { strip: 7, sm: true },
    { grid: "lg:grid-cols-[minmax(0,1fr)_360px]", cards: [{ body: "chart" }, { body: "bars" }] },
    { cards: [{ body: "table", rows: 8 }] },
  ],
  models: [
    { strip: 4 },
    { cards: [{ body: "chart" }] },
    { cards: [{ body: "table", rows: 10 }] },
  ],
  providers: [
    { strip: 5 },
    { cards: [{ body: "table", rows: 8 }] },
    { grid: "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]", cards: [{ body: "chart" }, { body: "bars", rows: 5 }] },
    { cards: [{ body: "table", rows: 6 }] },
  ],
  costs: [
    { strip: 4 },
    { grid: "xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]", cards: [{ body: "chart" }, { body: "bars", rows: 5 }] },
    { cards: [{ body: "table", rows: 8 }] },
  ],
  carbon: [
    { strip: 4 },
    { grid: "xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]", cards: [{ body: "bars" }, { body: "bars", rows: 4 }] },
    { cards: [{ body: "table", rows: 8 }] },
  ],
  requests: [{ strip: 6 }, { cards: [{ body: "table", rows: 12 }] }],
  errors: [
    { strip: 4 },
    { grid: "lg:grid-cols-[minmax(0,1fr)_320px]", cards: [{ body: "table", rows: 6 }, { body: "bars", rows: 5 }] },
    { cards: [{ body: "table", rows: 8 }] },
  ],
  traces: [{ cards: [{ body: "table", rows: 12 }] }],
  tools: [
    { strip: 5 },
    { strip: 4, sm: true },
    { cards: [{ body: "chart" }] },
    { cards: [{ body: "table", rows: 8 }] },
    { cards: [{ body: "table", rows: 8 }] },
  ],
  upstream: [
    { strip: 4 },
    { cards: [{ body: "table", rows: 5 }] },
    { cards: [{ body: "table", rows: 3 }] },
  ],
  projects: [
    { strip: 5 },
    { grid: "md:grid-cols-2", cards: [{ body: "bars", rows: 5 }, { body: "bars", rows: 5 }] },
    { cards: [{ body: "table", rows: 8 }] },
  ],
};

/** One figure, in the shape `Stat` draws: a small label over a bold value. */
function StatSkeleton({ sm }: { sm?: boolean }) {
  return (
    <div className={cn("min-w-0 px-4 py-3", sm && "py-2.5")}>
      <Skeleton className="h-2.5 w-20" />
      <Skeleton className={cn("mt-1.5", sm ? "h-3.5 w-14" : "h-4 w-16")} />
      {!sm && <Skeleton className="mt-1.5 h-2.5 w-24" />}
    </div>
  );
}

/** A share list, in the shape `BarList` draws: a label and a figure over one track. */
function BarsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <ul className="flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
          <Skeleton className="h-3" style={{ width: `${88 - ((i * 17) % 46)}%` }} />
          <Skeleton className="h-3 w-12" />
          <Skeleton className="col-span-2 h-1.5 w-full rounded-full" />
        </li>
      ))}
    </ul>
  );
}

/** A card's shell with no text, so the placeholder reads as the card it replaces. */
function SkeletonCard({ body, rows }: CardSpec) {
  return (
    <CardShell data-reveal className={cn(CARD_CHROME, "py-0")}>
      <div className="flex flex-col gap-1.5 border-b border-line px-3.5 pt-3 pb-2.5">
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-2.5 w-64 max-w-full" />
      </div>
      {/* Tables span the card, the way `flush` lets them. */}
      <CardContent className={cn("min-w-0", body === "table" ? "px-0 py-0" : "px-3.5 pt-2.5 pb-2")}>
        {body === "chart" && <ChartSkeleton />}
        {body === "table" && <TableSkeleton rows={rows} />}
        {body === "bars" && <BarsSkeleton rows={rows} />}
      </CardContent>
    </CardShell>
  );
}

function BlockSkeleton({ block }: { block: Block }) {
  if ("strip" in block) {
    return (
      <StatGrid cols={block.strip}>
        {Array.from({ length: block.strip }, (_, i) => (
          <StatSkeleton key={i} sm={block.sm} />
        ))}
      </StatGrid>
    );
  }
  const cards = block.cards.map((spec, i) => <SkeletonCard key={i} {...spec} />);
  return block.grid ? <div className={cn("grid gap-4", block.grid)}>{cards}</div> : <>{cards}</>;
}

/** The page while its snapshot is on the way, block for block the page it stands in for. */
export function PageSkeleton({ section }: { section: SectionId }) {
  return (
    <Page>
      <PageHeader title={navItem(section).label} description="Reading the agent databases…" />
      {LAYOUT[section].map((block, i) => (
        <BlockSkeleton key={i} block={block} />
      ))}
    </Page>
  );
}

/** The session trace while its transcript parses. Its container already stacks the blocks. */
export function TraceSkeleton() {
  return (
    <>
      <StatGrid cols={5}>
        {Array.from({ length: 9 }, (_, i) => (
          <StatSkeleton key={i} />
        ))}
      </StatGrid>
      <SkeletonCard body="chart" />
      <SkeletonCard body="table" rows={10} />
    </>
  );
}
