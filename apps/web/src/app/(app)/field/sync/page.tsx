import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getFieldSyncWithMeta, fieldSyncWindowNote, FIELD_SYNC_WINDOW_DAYS } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getFieldSyncWithMeta();
  const note = fieldSyncWindowNote(data);
  return (
    <div className="page-main">
      <ModuleListPage
        title="Offline Sync"
        description={`Device sync changes pulled from the last ${FIELD_SYNC_WINDOW_DAYS} days.`}
        rows={data.rows}
        source={source}
        back="/field"
        backLabel="Field Operations"
        errorArea="sync changes"
        cacheKey="module.field-offline-sync"
      >
        {/* GAP2-FIELD-SYNC-WINDOW-01: state the window/cap so a capped slice is
            never presented as the full pending set. */}
        <p className="muted" role="status" data-testid="field-sync-window-note">
          {note}
        </p>
      </ModuleListPage>
    </div>
  );
}
