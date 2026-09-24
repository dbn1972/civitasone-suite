import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getCatalogueRates } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getCatalogueRates();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/catalogue">Service Catalogue</a>
      </nav>
      <ModuleListPage
        title="Catalogue — Rates"
        description="Effective-dated rate cards."
        rows={data}
        source={source}
      />
    </div>
  );
}
