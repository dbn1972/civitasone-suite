import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getCdpSteward } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getCdpSteward();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/cdp">Customer Data Platform</a>
      </nav>
      <ModuleListPage
        title="CDP — Data Steward"
        description="Merge review and data-quality queue."
        rows={data}
        source={source}
      />
    </main>
  );
}
