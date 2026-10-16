import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantSettings } from "../_data";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function Page() {
  const t = await getTranslations("tenantPages");
  const { data, source } = await getTenantSettings();
  return (
    <div className="page-main">
      <ModuleListPage
        // GAP-TENANT-SETTINGS-06: no banned clerk term ("Tenant").
        title={t("settingsTitle")}
        // GAP-TENANT-SETTINGS-02: each setting's value is shown (in Meta) and
        // never hidden behind its description; secret-looking keys are masked.
        description={t("settingsSubtitle")}
        rows={data}
        showId={false}
        // Pinned: the title is translated, so the offline cache key must not derive from it.
        cacheKey="module.office-settings"
        source={source}
        back="/tenant"
        backLabel={t("office")}
        // GAP2-TENANT-ERRORSTATE-03: "Couldn't load settings", not "records".
        errorArea="settings"
      />
    </div>
  );
}
