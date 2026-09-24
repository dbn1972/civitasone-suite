import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getInstallSilos } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getInstallSilos();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/install/console">Install console</a>
      </nav>
      <ModuleListPage
        title="Install — Silo provisions"
        description="Silo provision records."
        rows={data}
        source={source}
      />
    </div>
  );
}
