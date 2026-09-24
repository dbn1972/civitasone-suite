import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getFieldSync } from "../_data";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getFieldSync();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/field">Field Operations</a>
      </nav>
      <ModuleListPage
        title="Field — Offline Sync"
        description="Pending device sync changes since epoch (pull window)."
        rows={data}
        source={source}
      />
    </div>
  );
}
