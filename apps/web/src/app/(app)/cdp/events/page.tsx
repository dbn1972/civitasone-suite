import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getCdpEvents } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getCdpEvents();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/cdp">Customer Data Platform</a>
      </nav>
      <ModuleListPage
        title="CDP — Events"
        description="Event taxonomy for interaction streams."
        rows={data}
        source={source}
      />
    </main>
  );
}
