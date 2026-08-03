import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getCdpProfiles } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getCdpProfiles();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/cdp">Customer Data Platform</a>
      </nav>
      <ModuleListPage
        title="CDP — Profiles"
        description="Golden customer profiles."
        rows={data}
        source={source}
      />
    </main>
  );
}
