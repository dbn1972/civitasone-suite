import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getCdpSegments } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getCdpSegments();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/cdp">Customer Data Platform</a>
      </nav>
      <ModuleListPage
        title="CDP — Segments"
        description="Audience segments for campaigns."
        rows={data}
        source={source}
      />
    </main>
  );
}
