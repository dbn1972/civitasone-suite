import { PageHeader, StatGrid, SkeletonCard, SkeletonTable } from "../../../_components/ds";
import { useTranslations } from "next-intl";

// GAP-CRM-LEAD-FORMS-06: match the loaded layout (header + 3 stat tiles + a
// table) instead of a bare "Loading…" line, so there is no layout jump.
export default function Loading() {
  const t = useTranslations("crm.loading");
  return (
    <>
      <PageHeader
        title={t("leadFormsTitle")}
        subtitle={t("leadFormsSubtitle")}
        back="/crm"
        backLabel={t("backCrm")}
      />
      <StatGrid>
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </StatGrid>
      <div style={{ marginTop: 20 }}>
        <SkeletonTable rows={6} />
      </div>
    </>
  );
}
