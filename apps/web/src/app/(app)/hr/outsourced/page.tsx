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
 *
 * GAP-HR-OUTSOURCED-01: whether to build the real module or park it
 * permanently is a product-scope decision the campaign's decision packet
 * left open ("build now or park?" with no default given) -- only the
 * honest-empty-state half (already shipped above) and the hub-tile /
 * subtitle copy fix (this file, hr/page.tsx) apply either way.
 * GAP-HR-OUTSOURCED-03: the empty state previously offered no next step at
 * all. /hr/contractual is a related (not identical) register and safe to
 * link from any HR session; a second link to /works/contractors was
 * considered but left out -- that module's own role gate wasn't verified
 * as part of this lane, and guessing it wrong would send some sessions to
 * a 403 instead of a useful next step.
 */
export default async function OutsourcedPage() {
  const t = await getTranslations("outsourced");
  const tc = await getTranslations("common");

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr" backLabel={tc("backToHr")} />
      <Card title={t("cardTitle")}>
        <EmptyState
          icon="🏢"
          title={t("emptyTitle")}
          message={t("emptyMessage")}
          action={<a href="/hr/contractual" className="btn">{t("emptyActionContractual")}</a>}
        />
      </Card>
    </div>
  );
}
