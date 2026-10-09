import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantStewardship } from "../_data";
import { LABELS } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getTenantStewardship();
  return (
    <div className="page-main">
      <ModuleListPage
        // GAP-TENANT-STEWARDSHIP-06: no banned clerk term ("Tenant").
        title={`${LABELS.tenantTitle} — Stewardship`}
        // GAP-TENANT-STEWARDSHIP-01: the owner (role · office) is mapped into
        // the Meta column, showing "Unassigned" when a domain has no owner.
        description="Data governance domains and their owners."
        rows={data}
        source={source}
        back="/tenant"
        backLabel={LABELS.tenantTitle}
        // GAP2-TENANT-ERRORSTATE-03
        errorArea="data governance domains"
      />
    </div>
  );
}
