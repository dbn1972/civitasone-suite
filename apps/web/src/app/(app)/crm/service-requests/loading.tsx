import { PageHeader, SkeletonTable } from "../../../_components/ds";
import { useTranslations } from "next-intl";

// GAP-CRM-SERVICE-REQUESTS-06: match the loaded layout (header + stat tiles +
// filter + table) instead of the generic three-bar template, so there is no
// layout jump when the data arrives. SkeletonTable renders the stat-card row,
// a filter toolbar and the table outline (header + rows).
export default function Loading() {
  const t = useTranslations("crm.loading");
  return (
    <div aria-busy="true" aria-label={t("serviceRequests")}>
      <PageHeader
        title={t("backServiceRequests")}
        subtitle={t("serviceRequestsSubtitle")}
        back="/crm"
      />
      <SkeletonTable rows={8} />
    </div>
  );
}
