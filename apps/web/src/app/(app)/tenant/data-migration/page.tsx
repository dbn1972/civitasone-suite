import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantDataMigration, getTenantImportBatches } from "../_data";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { MIGRATION_RETRY_ROLES } from "../_roles";
import { ImportBatchPanel } from "./ImportBatchPanel";

export const dynamic = "force-dynamic";

export default async function Page() {
  const t = await getTranslations("tenantPages");
  const [{ data, source }, batches] = await Promise.all([getTenantDataMigration(), getTenantImportBatches()]);
  // OWNER DECISION #23: only the migration admin may retry failed records.
  const canRetry = getSessionRoles().some((r) => MIGRATION_RETRY_ROLES.includes(r));
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
      >
        <ImportBatchPanel batches={batches.data} canRetry={canRetry} loadFailed={batches.source === "error"} />
      </ModuleListPage>
    </div>
  );
}
