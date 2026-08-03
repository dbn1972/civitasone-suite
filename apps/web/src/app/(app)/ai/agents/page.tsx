import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getAiAgents } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getAiAgents();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/ai">AI & Copilot</a>
      </nav>
      <ModuleListPage
        title="AI — Agents"
        description="Multi-agent workflows and orchestration."
        rows={data}
        source={source}
      />
    </main>
  );
}
