import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getFieldAgents } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getFieldAgents();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/field">Field Operations</a>
      </nav>
      <ModuleListPage
        title="Field — Agents"
        description="Agent roster derived from assigned field tasks."
        rows={data}
        source={source}
      />
    </div>
  );
}
