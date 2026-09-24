import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantCodeLists } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getTenantCodeLists();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/tenant">Tenant</a>
      </nav>
      <ModuleListPage
        title="Tenant — Code Lists"
        description="Reference code lists and effective-dated values."
        rows={data}
        source={source}
      />
    </div>
  );
}
