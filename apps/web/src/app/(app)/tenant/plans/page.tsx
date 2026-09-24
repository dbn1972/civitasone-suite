import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantPlans } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getTenantPlans();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/tenant">Tenant</a>
      </nav>
      <ModuleListPage
        title="Tenant — Plans"
        description="Available plans with pricing and module entitlements."
        rows={data}
        source={source}
      />
    </div>
  );
}
