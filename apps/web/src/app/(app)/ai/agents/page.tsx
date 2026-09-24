import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getAiAgents } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getAiAgents();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/ai">AI & Copilot</a>
      </nav>
      <ModuleListPage
        title="AI — Agents"
        description="Multi-agent workflows and orchestration."
        rows={data}
        source={source}
      />
    </div>
  );
}
