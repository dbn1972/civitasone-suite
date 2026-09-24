import { PageHeader, Card, EmptyState } from "../../../_components/ds";
import { getTranslations } from "next-intl/server";

/**
 * No backend endpoint serves outsourced-staff records (vendor, headcount,
 * service, contractValue, contractEnd). The only "outsourc*" hits under
 * services/hrms-service/src/modules are a code comment in
 * id-cards/routes.ts and one in leave/policy-admin-routes.ts -- neither is
 * a data endpoint. This page used to fetch /api/v1/hrms/employees?limit=50
 * and render it through outsourced-shaped columns the Employee record
 * doesn't have, producing rows with every outsourced-specific cell blank,
 * plus stat cards (unique vendors, active contracts, total headcount)
 * computed from that same wrong-shaped data. Rather than wire a
 * DataSourceBadge to a fetch that can never return the right data, show an
 * honest "not built yet" state.
 */
export default async function OutsourcedPage() {
  const t = await getTranslations("outsourced");

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel="Back to HR" />
      <Card title={t("cardTitle")}>
        <EmptyState icon="🏢" title={t("emptyTitle")} message={t("emptyMessage")} />
      </Card>
    </div>
  );
}
