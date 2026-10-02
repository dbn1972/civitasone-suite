import { FinancePageSkeleton } from "../_components/FinancePageSkeleton";

// GAP-FINANCE-PERIOD-CLOSE-07: four stat blocks, soft-close form card, periods table.
export default function Loading() {
  return <FinancePageSkeleton stats={4} blocks={[140, 320]} label="Loading period-close cockpit…" />;
}
