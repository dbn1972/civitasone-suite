import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getAiGuardrails } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getAiGuardrails();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/ai">AI & Copilot</a>
      </nav>
      <ModuleListPage
        title="AI — Guardrails"
        description="Safety policies and content filtering rules."
        rows={data}
        source={source}
      />
    </div>
  );
}
