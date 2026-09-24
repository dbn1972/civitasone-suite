import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getRecFeedback } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getRecFeedback();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/recommendations">Recommendations</a>
      </nav>
      <ModuleListPage
        title="Recommendations — Feedback"
        description="Acceptance and rejection analytics."
        rows={data}
        source={source}
      />
    </div>
  );
}
