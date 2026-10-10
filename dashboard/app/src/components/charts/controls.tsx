// Controls shared by every agent page: the segmented picker, search, and the loading shell.
import { cn } from "cn";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/common";
import { Icon } from "@/components/icon";

/** One choice out of a few, drawn with the shadcn tabs the Activity card uses. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string; title?: string }>;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <Tabs value={value} onValueChange={(next) => { if (next !== value) onChange(next as T); }} aria-label={label} className={cn("w-fit", className)}>
      <TabsList className="h-auto rounded-[10px] border border-line bg-panel p-1">
        {options.map((option) => (
          <TabsTrigger
            key={option.value}
            value={option.value}
            title={option.title}
            className="h-auto cursor-pointer px-3 py-1.5 text-xs tracking-normal text-dim data-[state=active]:font-bold"
          >
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <Icon name="search" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-dim" />
      <Input
        type="search"
        value={value}
        aria-label={label}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mono h-8 w-full rounded-lg border-line bg-panel pl-8 text-xs placeholder:text-dim"
      />
    </div>
  );
}

/** Loading, missing, empty, or content. One shell, so no page invents a fourth state. */
export function QueryView({
  loading,
  error,
  empty,
  emptyIcon = "circle-slash",
  emptyTitle,
  emptyDesc,
  children,
}: {
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyIcon?: string;
  emptyTitle: string;
  emptyDesc: string;
  children: React.ReactNode;
}) {
  if (loading) return <ChartSkeleton />;
  if (error) return <EmptyState icon="triangle-alert" title="Could not read the source" desc={error} />;
  if (empty) return <EmptyState icon={emptyIcon} title={emptyTitle} desc={emptyDesc} />;
  return <>{children}</>;
}

export function ChartSkeleton({ className, height = 220 }: { className?: string; height?: number }) {
  return (
    <div className={cn("flex flex-col gap-3", className)} aria-busy="true" aria-label="Loading chart">
      <Skeleton style={{ height }} className="w-full rounded-xl bg-track/60" />
      <div className="flex gap-3">
        <Skeleton className="h-3 w-20 bg-track/60" />
        <Skeleton className="h-3 w-16 bg-track/60" />
        <Skeleton className="h-3 w-24 bg-track/60" />
      </div>
    </div>
  );
}
