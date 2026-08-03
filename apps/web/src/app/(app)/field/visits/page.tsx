import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getFieldVisits } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getFieldVisits();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/field">Field Operations</a>
      </nav>
      <ModuleListPage
        title="Field — Visits"
        description="Visit tracking entry points (tasks with check-in/out)."
        rows={data}
        source={source}
      />
    </main>
  );
}
