import { getTranslations } from "next-intl/server";
import { SkeletonBar, SkeletonCard } from "../../../_components/ds/Skeleton";

// GAP-HR-ORG-CHART-07: this used to be a single bare .animate-pulse block
// with raw Tailwind slate classes and no stat-row skeleton, unlike every
// other recently-fixed HR page (e.g. hr/onboarding/loading.tsx), which use
// the shared ds Skeleton primitives and mirror the loaded page's actual
// shape (header + stat row + content block) so there's no visible layout
// jump once real content arrives.
export default async function Loading() {
  const t = await getTranslations("msg");
  return (
    <div className="page-main wrap" aria-label={t("loading")} aria-busy="true">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <SkeletonBar w={220} h={22} style={{ marginBottom: 8 }} />
          <SkeletonBar w={340} h={13} />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>

      <div
        style={{
          border: "1px solid var(--line, #e2e8f0)",
          borderRadius: 10,
          padding: 24,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
        }}
      >
        <SkeletonBar w={160} h={38} style={{ borderRadius: 8 }} />
        <SkeletonBar w={2} h={20} />
        <div style={{ display: "flex", gap: 16 }}>
          <SkeletonBar w={140} h={64} style={{ borderRadius: 8 }} />
          <SkeletonBar w={140} h={64} style={{ borderRadius: 8 }} />
          <SkeletonBar w={140} h={64} style={{ borderRadius: 8 }} />
        </div>
      </div>
    </div>
  );
}
