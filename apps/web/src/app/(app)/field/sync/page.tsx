import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getFieldSync, FIELD_SYNC_WINDOW_DAYS } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getFieldSync();
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <ModuleListPage
        title="Offline Sync"
        description={`Device sync changes pulled from the last ${FIELD_SYNC_WINDOW_DAYS} days.`}
        rows={data}
        source={source}
        back="/field"
        backLabel="Field Operations"
        errorArea="sync changes"
        cacheKey="module.field-offline-sync"
      />
    </div>
  );
}
