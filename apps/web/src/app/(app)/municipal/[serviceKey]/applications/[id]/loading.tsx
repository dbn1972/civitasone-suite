import { SkeletonBar } from "@/app/_components/ds";

// GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-05: skeleton for the
// force-dynamic record detail page (header + details card) during a slow
// gateway fetch.
export default function MunicipalRecordDetailLoading() {
  return (
    <div aria-busy="true" aria-label="Loading record…" style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <SkeletonBar w={260} h={24} />
        <SkeletonBar w={200} h={13} />
      </div>
      <div style={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 12, padding: 18, display: "grid", gap: 12 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(140px, 220px) 1fr", gap: 12 }}>
            <SkeletonBar w="60%" h={12} />
            <SkeletonBar w="80%" h={13} />
          </div>
        ))}
      </div>
    </div>
  );
}
