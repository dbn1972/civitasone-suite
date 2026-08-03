import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getAiCopilot } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getAiCopilot();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/ai">AI & Copilot</a>
      </nav>
      <ModuleListPage
        title="AI — Copilot"
        description="In-context copilot turns."
        rows={data}
        source={source}
      />
    </main>
  );
}
