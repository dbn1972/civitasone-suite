import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantSettings } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getTenantSettings();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/tenant">Tenant</a>
      </nav>
      <ModuleListPage
        title="Tenant — Settings"
        description="Tenant-scoped configuration keys and values."
        rows={data}
        source={source}
      />
    </div>
  );
}
