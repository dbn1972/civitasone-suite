import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantQuotas } from "../_data";
import { LABELS } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getTenantQuotas();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <ModuleListPage
        // GAP-TENANT-QUOTAS-07: no banned clerk term ("Tenant").
        title={`${LABELS.tenantTitle} — Quotas & Usage`}
        // GAP-TENANT-QUOTAS-01: used/limit and percent are now mapped per row.
        description="Resource consumption against plan limits for this office."
        rows={data}
        source={source}
        back="/tenant"
        backLabel={LABELS.tenantTitle}
      />
    </div>
  );
}
