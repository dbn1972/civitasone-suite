import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantPositions } from "../_data";
import { LABELS } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getTenantPositions();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <ModuleListPage
        // GAP-TENANT-POSITIONS-06: no banned clerk term ("Tenant"); use the
        // standardised "Office" label (LABELS.tenantTitle) instead.
        title={`${LABELS.tenantTitle} — Positions`}
        // GAP-TENANT-POSITIONS-01: the list payload carries no role bindings,
        // so the old "and role bindings" promise is dropped; sanctioned/filled
        // strength and a Vacant indicator are shown via mapPositionRows.
        description="Position master records with sanctioned strength and vacancies."
        rows={data}
        source={source}
        back="/tenant"
        backLabel={LABELS.tenantTitle}
      />
    </div>
  );
}
