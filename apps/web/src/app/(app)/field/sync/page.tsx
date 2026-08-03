import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getFieldSync } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getFieldSync();
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/field">Field Operations</a>
      </nav>
      <ModuleListPage
        title="Field — Offline Sync"
        description="Pending device sync changes since epoch (pull window)."
        rows={data}
        source={source}
      />
    </main>
  );
}
