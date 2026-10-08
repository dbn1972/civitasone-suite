import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantSubscriptions } from "../_data";
import { LABELS } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getTenantSubscriptions();
  return (
    <div className="page-main">
      <ModuleListPage
        // GAP-TENANT-SUBSCRIPTIONS-07: no banned clerk term ("Tenant").
        title={`${LABELS.tenantTitle} — Subscriptions`}
        // GAP-TENANT-SUBSCRIPTIONS-01/05: lead with the plan (not a raw id),
        // show the renewal date and, when present, the amount (paise-correct).
        description="Current subscription plan, renewal date and lifecycle state."
        rows={data}
        source={source}
        back="/tenant"
        backLabel={LABELS.tenantTitle}
        // GAP2-TENANT-ERRORSTATE-03
        errorArea="subscription"
      />
    </div>
  );
}
