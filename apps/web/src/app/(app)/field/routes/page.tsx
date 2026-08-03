import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getFieldRoutes } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getFieldRoutes();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/field">Field Operations</a>
      </nav>
      <ModuleListPage
        title="Field — Routes"
        description="Optimised daily routes for field agents."
        rows={data}
        source={source}
      />
    </main>
  );
}
