import { getTranslations } from "next-intl/server";
import { PageHeader, SkeletonBar, SkeletonCard } from "../../../_components/ds";

// GAP-HR-ID-CARDS-07: was a hand-rolled `.ph` div with its own bare <h1> --
// no back link (the real page uses PageHeader with back='/hr'), so the
// heading position/back-affordance visibly shifted once content loaded.
// Reuses the real PageHeader (back='/hr' matches the loaded page exactly)
// plus the shared Skeleton primitives already used elsewhere in /hr.
export default async function Loading() {
  const t = await getTranslations("idCards");
  return (
    <div className="page-main wrap" aria-busy="true" role="status">
      <span className="sr-only">{t("loadingSubtitle")}</span>
      <PageHeader title={t("title")} subtitle={t("loadingSubtitle")} back="/hr" backLabel="Back to HR" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
        {[0, 1, 2, 3].map((i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
      <SkeletonBar w="100%" h={240} style={{ borderRadius: 12 }} />
    </div>
  );
}
