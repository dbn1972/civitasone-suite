import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getFieldTasks } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getFieldTasks();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/field">Field Operations</a>
      </nav>
      <ModuleListPage
        title="Field — Tasks"
        description="Field task assignments from field-service."
        rows={data}
        source={source}
      />
    </div>
  );
}
