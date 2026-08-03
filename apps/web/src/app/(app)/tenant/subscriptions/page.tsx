import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getTenantSubscriptions } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getTenantSubscriptions();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/tenant">Tenant</a>
      </nav>
      <ModuleListPage
        title="Tenant — Subscriptions"
        description="Current subscription details and lifecycle state."
        rows={data}
        source={source}
      />
    </main>
  );
}
