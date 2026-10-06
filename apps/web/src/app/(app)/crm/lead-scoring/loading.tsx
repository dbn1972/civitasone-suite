import { PageHeader, SkeletonBar } from "../../../_components/ds";
import { useTranslations } from "next-intl";

// GAP-CRM-LEAD-SCORING-07 (LOADING): the loaded page is a header + a single
// card (no stat tiles), so the skeleton mirrors that instead of 4 stat tiles
// plus a 280px slab the page never renders.
export default function Loading() {
  const t = useTranslations("crm.loading");
  return (
    <>
      <PageHeader
        title={t("leadScoringTitle")}
        subtitle={t("leadScoringSubtitle")}
        back="/crm"
        backLabel={t("backCrm")}
      />
      <div className="card" aria-busy="true" aria-label={t("scoringRules")}>
        <div className="card-h">
          <SkeletonBar w={160} h={16} />
        </div>
        <div style={{ padding: 12, display: "grid", gap: 10 }}>
          {[0, 1, 2, 3].map((i) => (
            <SkeletonBar key={i} w="100%" h={40} />
          ))}
        </div>
      </div>
    </>
  );
}
