import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getAiChat } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getAiChat();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/ai">AI & Copilot</a>
      </nav>
      <ModuleListPage
        title="AI — Chat"
        description="AI chat conversations from ai-agent-service."
        rows={data}
        source={source}
      />
    </main>
  );
}
