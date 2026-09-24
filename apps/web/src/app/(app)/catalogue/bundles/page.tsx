import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getCatalogueBundles } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getCatalogueBundles();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/catalogue">Service Catalogue</a>
      </nav>
      <ModuleListPage
        title="Catalogue — Bundles"
        description="Product bundles and combo offerings."
        rows={data}
        source={source}
      />
    </div>
  );
}
