import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantDataMigration } from "../_data";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const t = await getTranslations("tenantPages");
  const { data, source } = await getTenantDataMigration();
  return (
    <div className="page-main">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/tenant">{t("office")}</a>
      </nav>
      <ModuleListPage
        title={t("dataMigrationTitle")}
        description={t("dataMigrationSubtitle")}
        rows={data}
        showId={false}
        // Pinned: the title is translated, so the offline cache key must not derive from it.
        cacheKey="module.office-data-migration"
        source={source}
        errorArea="data migrations"
      />
    </div>
  );
}
