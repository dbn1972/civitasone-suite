import { getTranslations } from "next-intl/server";
import { ModuleListPage } from "../../../_components/ModuleListPage";
import { getFieldSyncWithMeta, fieldSyncWindowNote, FIELD_SYNC_WINDOW_DAYS } from "../_data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { data, source } = await getFieldSyncWithMeta();
  const t = await getTranslations("fieldSync");
  // On a failed load the table renders its own failure state; a "0 shown" note
  // would read as a genuine empty result, so it is omitted.
  const note = source === "error" ? null : fieldSyncWindowNote(data, (key, values) => t(key, values));
  return (
    <div className="page-main">
      <ModuleListPage
        title={t("title")}
        description={t("description", { days: FIELD_SYNC_WINDOW_DAYS })}
        rows={data.rows}
        source={source}
        back="/field"
        backLabel={t("backLabel")}
        errorArea={t("errorArea")}
        cacheKey="module.field-offline-sync"
      >
        {/* GAP2-FIELD-SYNC-WINDOW-01: state the window/cap so a capped slice is
            never presented as the full pending set. */}
        {note !== null && (
          <p className="muted" role="status" data-testid="field-sync-window-note">
            {note}
          </p>
        )}
      </ModuleListPage>
    </div>
  );
}
