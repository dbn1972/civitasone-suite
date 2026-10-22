import { SkeletonBar, SkeletonTable } from "../../../../_components/ds";

export default function DelegationsLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading delegations…</span>
      <div style={{ display: "grid", gap: 8, marginBottom: 18 }}>
        <SkeletonBar w={288} h={30} />
        <SkeletonBar w={448} h={16} />
      </div>
      <SkeletonTable rows={4} statCards={0} quiet />
    </div>
  );
}
