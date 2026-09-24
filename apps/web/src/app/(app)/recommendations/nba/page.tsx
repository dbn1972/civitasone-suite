import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getRecNba } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getRecNba();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/recommendations">Recommendations</a>
      </nav>
      <ModuleListPage
        title="Recommendations — Next Best Action"
        description="Predictive / NBA signals from recommendation-service."
        rows={data}
        source={source}
      />
    </div>
  );
}
