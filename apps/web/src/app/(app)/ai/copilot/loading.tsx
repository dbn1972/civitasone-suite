import { SkeletonTable } from "../../../_components/ds";

// GAP-AI-HOME-04: replaced fixed Tailwind light colours + min-h-screen with the
// DS SkeletonTable, which uses theme tokens (readable in .dark mode) and no
// page background/min-height of its own.
export default function CopilotLoading() {
  return <SkeletonTable rows={6} />;
}
