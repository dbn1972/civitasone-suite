import { PageSkeleton } from "../_components/PageSkeleton";

export default function Loading() {
  // Mirrors page.tsx: header, period selector, four stat cards, tabbed table.
  return <PageSkeleton label="Loading GST console" statCards={4} formFields={1} formFirst />;
}
