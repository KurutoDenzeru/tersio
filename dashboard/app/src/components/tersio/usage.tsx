// Tersio's own ledger, kept beside the omp pages: tokens, savings, activity, and the raw tables.
import { Page, PageHeader } from "@/components/charts";
import { Hero } from "@/components/hero";
import { Savings } from "@/components/savings";
import { Activity } from "@/components/activity";
import { Models } from "@/components/models";
import { Recent } from "@/components/recent";
import { Tools } from "@/components/tools";
import type { FxState, UsageReport } from "@/lib/data";

/** One page for everything Tersio records itself, from `~/.tersio/usage.db`. */
export function UsagePage({
  data,
  fx,
  money,
  onCurrency,
}: {
  data: UsageReport | null;
  fx: FxState;
  money: (v: number) => string;
  onCurrency: (code: string) => void;
}) {
  return (
    <>
      <Hero data={data} />
      <Page>
        <PageHeader
          title="Usage"
          description="Tersio's own ledger: the tokens every session reported, what the savings are worth, and where the tokens went."
        />
        <Savings data={data} fx={fx} money={money} onCurrency={onCurrency} />
        <Activity data={data} />
        <Models data={data} money={money} />
        <Recent data={data} money={money} />
        <Tools data={data} />
      </Page>
    </>
  );
}
