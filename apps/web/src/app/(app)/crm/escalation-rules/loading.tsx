import { SkeletonBar, SkeletonRow } from "../../../_components/ds/Skeleton";
import { useTranslations } from "next-intl";

/**
 * GAP-CRM-ESCALATION-RULES-06: the page has no stat tiles, so the skeleton no
 * longer renders a four-tile row + 280px block. It now mirrors the real page:
 * a header and a card with a table-row skeleton, using ds Skeleton theme
 * tokens instead of hard-coded #f1f5f9 blocks.
 * GAP-CRM-ESCALATION-RULES-07: the skeleton title matches the page's new
 * "Lead Escalation Rules" heading.
 */
export default function LeadEscalationRulesLoading() {
  const t = useTranslations("crm.loading");
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <div className="ph">
        <div>
          <h1 id="page-heading">{t("escalationRulesTitle")}</h1>
        </div>
      </div>
      <div className="card" aria-busy="true" aria-label={t("escalationRules")} style={{ padding: 16 }}>
        <SkeletonBar w={180} h={16} style={{ marginBottom: 16 }} />
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    </div>
  );
}
