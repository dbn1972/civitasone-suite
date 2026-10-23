import { PageSkeleton } from "../_components/PageSkeleton";

export default function Loading() {
  // Mirrors page.tsx: header, period selector, the SIX stat cards (Output Tax, ITC, Net balance, Surplus credit,
  // Estimated cash payable, Transactions -- two rows of the 4-column grid), then the tabbed table. Keep the count in step
  // with the page: loading.test.tsx fails when they drift apart (GAP-FINANCE-GST-07).
  return <PageSkeleton label="Loading GST console" statCards={6} formFields={1} formFirst />;
}
