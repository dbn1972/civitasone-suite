import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantStewardship } from "../_data";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function Page() {
  const t = await getTranslations("tenantPages");
  const { data, source } = await getTenantStewardship();
  return (
    <div className="page-main">
      <ModuleListPage
        // GAP-TENANT-STEWARDSHIP-06: no banned clerk term ("Tenant").
        title={t("stewardshipTitle")}
        // GAP-TENANT-STEWARDSHIP-01: the owner (role · office) is mapped into
        // the Meta column, showing "Unassigned" when a domain has no owner.
        description={t("stewardshipSubtitle")}
        rows={data}
        showId={false}
        // Pinned: the title is translated, so the offline cache key must not derive from it.
        cacheKey="module.office-stewardship"
        source={source}
        back="/tenant"
        backLabel={t("office")}
        // GAP2-TENANT-ERRORSTATE-03
        errorArea="data governance domains"
      />
    </div>
  );
}
