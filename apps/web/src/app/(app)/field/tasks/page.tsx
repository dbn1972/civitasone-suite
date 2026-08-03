import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getFieldTasks } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getFieldTasks();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/field">Field Operations</a>
      </nav>
      <ModuleListPage
        title="Field — Tasks"
        description="Field task assignments from field-service."
        rows={data}
        source={source}
      />
    </main>
  );
}
