import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantSubscriptions } from "../_data";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function Page() {
  const t = await getTranslations("tenantPages");
  const { data, source } = await getTenantSubscriptions();
  return (
    <div className="page-main">
      <ModuleListPage
        // GAP-TENANT-SUBSCRIPTIONS-07: no banned clerk term ("Tenant").
        title={t("subscriptionsTitle")}
        // GAP-TENANT-SUBSCRIPTIONS-01/05: lead with the plan (not a raw id),
        // show the renewal date and, when present, the amount (paise-correct).
        description={t("subscriptionsSubtitle")}
        rows={data}
        showId={false}
        // Pinned: the title is translated, so the offline cache key must not derive from it.
        cacheKey="module.office-subscriptions"
        source={source}
        back="/tenant"
        backLabel={t("office")}
        // GAP2-TENANT-ERRORSTATE-03
        errorArea="subscription"
      />
    </div>
  );
}
