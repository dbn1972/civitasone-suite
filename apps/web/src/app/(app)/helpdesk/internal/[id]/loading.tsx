import { SkeletonBar, SkeletonCard } from "../../../../_components/ds";

export default function InternalTicketDetailLoading() {
  return (
    <div aria-busy="true" aria-label="Loading ticket details…" style={{ padding: "4px 0" }}>
      <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <SkeletonBar w={220} h={28} />
        <SkeletonBar w={200} h={14} />
      </div>
      <SkeletonCard />
    </div>
  );
}
