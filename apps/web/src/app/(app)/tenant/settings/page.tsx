import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantSettings } from "../_data";
import { LABELS } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getTenantSettings();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <ModuleListPage
        // GAP-TENANT-SETTINGS-06: no banned clerk term ("Tenant").
        title={`${LABELS.tenantTitle} — Settings`}
        // GAP-TENANT-SETTINGS-02: each setting's value is shown (in Meta) and
        // never hidden behind its description; secret-looking keys are masked.
        description="Office configuration keys and their values."
        rows={data}
        source={source}
        back="/tenant"
        backLabel={LABELS.tenantTitle}
      />
    </div>
  );
}
