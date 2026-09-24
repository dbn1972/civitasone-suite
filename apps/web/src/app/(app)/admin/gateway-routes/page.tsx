import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getGatewayCatalogue } from "./_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getGatewayCatalogue();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/admin">Admin</a>
      </nav>
      <ModuleListPage
        title="Gateway — Route catalogue"
        description="API gateway proxy catalogue entries from gateway-service."
        rows={data}
        source={source}
      />
    </div>
  );
}
