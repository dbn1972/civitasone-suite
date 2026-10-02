import { SkeletonBar } from "@/app/_components/ds";

/** Skeleton for the domain registration form (domains/new). */
export default function DomainsLoading() {
  return (
    <div className="page-main" aria-busy="true" aria-label="Loading">
      <div className="ph" style={{ marginBottom: 20 }}>
        <SkeletonBar w={240} h={28} />
        <SkeletonBar w={340} h={18} style={{ marginTop: 6 }} />
      </div>
      <div style={{ display: "grid", gap: 16, maxWidth: 560 }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i}>
            <SkeletonBar w={120} h={13} style={{ marginBottom: 8 }} />
            <SkeletonBar h={38} />
          </div>
        ))}
        <SkeletonBar w={140} h={38} />
      </div>
    </div>
  );
}
