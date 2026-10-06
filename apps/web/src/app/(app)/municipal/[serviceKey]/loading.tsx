import { SkeletonCard, SkeletonBar } from "@/app/_components/ds";

// GAP-MUNICIPAL-SERVICEKEY-05: skeleton for the force-dynamic service home
// (PageHeader + 2 StatCards + workspace card) while the gateway list resolves.
export default function MunicipalServiceLoading() {
  return (
    <div aria-busy="true" aria-label="Loading service…" style={{ display: "grid", gap: 18 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <SkeletonBar w={220} h={26} />
        <SkeletonBar w={320} h={14} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
        {[0, 1].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div style={{ ...{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: 18, display: "grid", gap: 10 } }}>
        <SkeletonBar w={160} h={16} />
        <SkeletonBar w="80%" h={13} />
        <SkeletonBar w={180} h={34} />
      </div>
    </div>
  );
}
