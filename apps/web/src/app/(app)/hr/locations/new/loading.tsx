import { PageHeader } from "../../../../_components/ds";
import { getTranslations } from "next-intl/server";

/**
 * GAP-HR-LOCATIONS-NEW-04: this was a bare `.skeleton` div with a
 * hard-coded English aria-label ("Loading...") -- no header, no shape
 * resembling the form it precedes. Same pattern as hr/designations/new/
 * loading.tsx (GAP-HR-DESIGNATIONS-NEW-05) and hr/departments/new/
 * loading.tsx (GAP-HR-DEPARTMENTS-NEW-05).
 */
export default async function NewLocationLoading() {
  const t = await getTranslations("addLocationForm");
  return (
    <div className="page-main wrap">
      <PageHeader title={t("pageTitle")} subtitle={t("pageSubtitle")} />
      <div className="card" aria-label={t("loadingLabel")} style={{ marginTop: 16 }}>
        <div className="pad" style={{ display: "grid", gap: 16 }}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} style={{ display: "grid", gap: 6 }}>
              <div className="skeleton" style={{ height: 13, width: "30%", borderRadius: 4 }} />
              <div className="skeleton" style={{ height: 44, borderRadius: 8 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
