import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getRecFeedback } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getRecFeedback();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/recommendations">Recommendations</a>
      </nav>
      <ModuleListPage
        title="Recommendations — Feedback"
        description="Acceptance and rejection analytics."
        rows={data}
        source={source}
      />
    </main>
  );
}
