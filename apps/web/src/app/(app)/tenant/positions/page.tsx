import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantPositions } from "../_data";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function Page() {
  const t = await getTranslations("tenantPages");
  const { data, source } = await getTenantPositions();
  return (
    <div className="page-main">
      <ModuleListPage
        // GAP-TENANT-POSITIONS-06: no banned clerk term ("Tenant"); use the
        // standardised "Office" label (LABELS.tenantTitle) instead.
        title={t("positionsTitle")}
        // GAP-TENANT-POSITIONS-01: the list payload carries no role bindings,
        // so the old "and role bindings" promise is dropped; sanctioned/filled
        // strength and a Vacant indicator are shown via mapPositionRows.
        description={t("positionsSubtitle")}
        rows={data}
        showId={false}
        // Pinned: the title is translated, so the offline cache key must not derive from it.
        cacheKey="module.office-positions"
        source={source}
        back="/tenant"
        backLabel={t("office")}
        // GAP2-TENANT-ERRORSTATE-03
        errorArea="positions"
      />
    </div>
  );
}
