import { PageHeader, SkeletonBar } from "../../../_components/ds";
import { useTranslations } from "next-intl";

// GAP-CRM-LEAD-REASON-CODES-05 (COPY): heading matches the page title
// "Lead Stage Reasons" (page.tsx / card / error all agree).
// GAP-CRM-LEAD-REASON-CODES-06 (LOADING): the loaded page is a single card
// (no stat tiles), so the skeleton is a header + one card block, not four
// stat tiles + a 280px slab.
export default function Loading() {
  const t = useTranslations("crm.loading");
  return (
    <>
      <PageHeader
        title={t("leadReasonCodesTitle")}
        subtitle={t("leadReasonCodesSubtitle")}
        back="/crm"
        backLabel={t("backCrm")}
      />
      <div className="card" aria-busy="true" aria-label={t("reasonCodes")}>
        <div className="card-h">
          <SkeletonBar w={180} h={16} />
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
