import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantQuotas } from "../_data";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function Page() {
  const t = await getTranslations("tenantPages");
  const { data, source } = await getTenantQuotas();
  return (
    <div className="page-main">
      <ModuleListPage
        // GAP-TENANT-QUOTAS-07: no banned clerk term ("Tenant").
        title={t("quotasTitle")}
        // GAP-TENANT-QUOTAS-01: used/limit and percent are now mapped per row.
        description={t("quotasSubtitle")}
        rows={data}
        showId={false}
        statusStyle="quota"
        // Pinned: the title is translated, so the offline cache key must not derive from it.
        cacheKey="module.office-quotas-usage"
        source={source}
        back="/tenant"
        backLabel={t("office")}
        // GAP2-TENANT-ERRORSTATE-03
        errorArea="quotas & usage"
      />
    </div>
  );
}
