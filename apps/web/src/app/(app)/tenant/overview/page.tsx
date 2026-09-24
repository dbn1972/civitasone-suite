import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantOverview } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getTenantOverview();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/tenant">Tenant</a>
      </nav>
      <ModuleListPage
        title="Tenant — Overview"
        description="Current tenant profile from tenant-service."
        rows={data}
        source={source}
      />
    </div>
  );
}
