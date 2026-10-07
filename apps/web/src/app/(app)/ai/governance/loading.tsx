import { SkeletonBar, SkeletonTable } from "../../../_components/ds";

// GAP-AI-HOME-04: replaced fixed Tailwind light colours + min-h-screen with DS
// skeleton primitives that use theme tokens (readable in .dark mode) and carry
// no page background/min-height of their own.
export default function AiGovernanceLoading() {
  return (
    <div aria-busy="true" aria-label="Loading…" style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <SkeletonBar w={180} h={28} />
        <SkeletonBar w={300} h={14} />
      </div>
      <SkeletonTable rows={6} />
    </div>
  );
}
