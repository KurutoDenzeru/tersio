// Route props shared by every page. One shape, so App can switch on a string.
import type { FxState, UsageReport } from "@/lib/data";
import type { RangeId } from "@/lib/route";

export interface PageProps {
  data: UsageReport;
  /** Earliest day inside the selected range; null for all time and for the short ranges. */
  cutoff: string | null;
  /** Exact window start for 1h/24h, which read recent rows instead of the day tables; null otherwise. */
  since: number | null;
  range: RangeId;
  /** Transcript file when the route carries ?session=<file>; only the traces page reads it. */
  session?: string | null;
  /** Selects or clears that session param. */
  onSession?: (file: string | null) => void;
  money: (v: number) => string;
  /** Currency state and setter, for the sections that still render their own picker. */
  fx: FxState;
  onCurrency: (code: string) => void;
}
