import { getTranslations } from "next-intl/server";
import { SkeletonBar, SkeletonCard, SkeletonRow } from "../../../../_components/ds/Skeleton";

/**
 * GAP-PAYROLL-DISBURSEMENT-09: mirrors the real page -- header, four stat
 * cards, section links, then the transfers table and the remaining cards --
 * instead of a single bare skeleton block.
 */
export default async function Loading() {
  const t = await getTranslations("disbursement");
  return (
    <div className="page-main wrap" role="status" aria-busy="true" aria-label={t("loadingAriaLabel")}>
      <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
        <SkeletonBar w="40%" h={24} />
        <SkeletonBar w="60%" h={14} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 16 }}>
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[0, 1, 2, 3].map((i) => (
          <SkeletonBar key={i} w={96} h={28} />
        ))}
      </div>
      <div style={{ display: "grid", gap: 16 }}>
        <div className="card" style={{ padding: 18 }}>
          <SkeletonBar w="30%" h={16} style={{ marginBottom: 12 }} />
          {[0, 1, 2, 3, 4].map((i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}
