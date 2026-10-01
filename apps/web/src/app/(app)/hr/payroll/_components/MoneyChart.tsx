"use client";

import { Chart, type ChartDataPoint } from "../../../../_components/Chart";
import { formatMoney } from "@/lib/formatters";

/**
 * GAP-PAYROLL-GPF-06 / GAP-PAYROLL-NPS-06: a Chart whose values are money in
 * MINOR units (paise), labelled with formatMoney (₹ + lakh grouping + 2dp).
 *
 * Exists because Chart is a "use client" component and its `valueFormatter`
 * prop is a function -- a Server Component page (gpf/page.tsx, nps/page.tsx)
 * cannot pass a function across that boundary. This wrapper owns the
 * formatter on the client side so server pages pass only plain data.
 */
export function MoneyChart({ type, data, height }: { type: "bar" | "line"; data: ChartDataPoint[]; height?: number }) {
  return <Chart type={type} data={data} height={height} valueFormatter={(v) => formatMoney(v)} />;
}
