import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantPositions } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getTenantPositions();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/tenant">Tenant</a>
      </nav>
      <ModuleListPage
        title="Tenant — Positions"
        description="Position master records and role bindings."
        rows={data}
        source={source}
      />
    </main>
  );
}
