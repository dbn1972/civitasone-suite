import { PageSkeleton } from "../_components/PageSkeleton";

export default function Loading() {
  // Mirrors page.tsx: header, two stat cards, the create form, the table.
  return <PageSkeleton label="Loading fiscal years…" statCards={2} formFields={4} />;
}
