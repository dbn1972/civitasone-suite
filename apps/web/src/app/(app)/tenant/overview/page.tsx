import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantOverview } from "../_data";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const t = await getTranslations("tenantPages");
  const { data, source } = await getTenantOverview();
  return (
    <div className="page-main">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/tenant">{t("office")}</a>
      </nav>
      <ModuleListPage
        title={t("overviewTitle")}
        description={t("overviewSubtitle")}
        rows={data}
        showId={false}
        // Pinned: the title is translated, so the offline cache key must not derive from it.
        cacheKey="module.office-overview"
        source={source}
        // GAP2-TENANT-ERRORSTATE-03: specific error copy ("Couldn't load the
        // office profile") instead of the generic "records".
        errorArea="office profile"
      />
    </div>
  );
}
