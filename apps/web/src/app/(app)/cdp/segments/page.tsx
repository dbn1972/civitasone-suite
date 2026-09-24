import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getCdpSegments } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getCdpSegments();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/cdp">Customer Data Platform</a>
      </nav>
      <ModuleListPage
        title="CDP — Segments"
        description="Audience segments for campaigns."
        rows={data}
        source={source}
      />
    </div>
  );
}
