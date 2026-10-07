import { PageHeader } from "../../../../_components/ds";
import { getTranslations } from "next-intl/server";

/**
 * GAP-HR-EMPLOYEES-NEW-08: this was a bare `.skeleton` div with a
 * hard-coded English aria-label ("Loading...") -- no header, no shape
 * resembling the 5-step wizard it precedes.
 */
export default async function NewEmployeeLoading() {
  const t = await getTranslations("employeeWizard");
  return (
    <div className="page-main wrap">
      <PageHeader title={t("pageTitle")} subtitle={t("pageSubtitle")} />
      <div className="skeleton" style={{ height: 32, borderRadius: 8, marginBottom: 20 }} aria-label={t("loadingLabel")} />
      <div style={{ border: "1px solid var(--line, #e2e8f0)", borderRadius: 8, padding: 24, display: "grid", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px 24px" }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ display: "grid", gap: 6 }}>
              <div className="skeleton" style={{ height: 13, width: "40%", borderRadius: 4 }} />
              <div className="skeleton" style={{ height: 44, borderRadius: 8 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
