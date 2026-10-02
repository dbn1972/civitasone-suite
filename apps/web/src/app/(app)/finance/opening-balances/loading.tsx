import { FinancePageSkeleton } from "../_components/FinancePageSkeleton";

// GAP-FINANCE-OPENING-BALANCES-07: fiscal-year select card, three stat blocks, entry form, table.
export default function Loading() {
  return <FinancePageSkeleton stats={3} blocks={[96, 220, 320]} label="Loading opening balances…" />;
}
