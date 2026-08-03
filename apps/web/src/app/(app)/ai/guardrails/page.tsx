import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getAiGuardrails } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getAiGuardrails();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/ai">AI & Copilot</a>
      </nav>
      <ModuleListPage
        title="AI — Guardrails"
        description="Safety policies and content filtering rules."
        rows={data}
        source={source}
      />
    </main>
  );
}
