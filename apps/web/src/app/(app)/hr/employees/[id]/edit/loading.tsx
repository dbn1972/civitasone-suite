import { PageHeader } from "../../../../../_components/ds";
import { getTranslations } from "next-intl/server";

/**
 * GAP-HR-EMPLOYEES-DETAIL-EDIT-07: this was a single bare `.skeleton` div
 * with a hard-coded English aria-label -- no header, no field shapes, so
 * the loading state looked nothing like (and was a different height than)
 * the form it precedes, causing a layout jump. Mirrors the header + card
 * skeleton pattern already used by employees/loading.tsx.
 */
export default async function EditEmployeeLoading() {
  const t = await getTranslations("employeeEdit");
  const fieldSkeleton = (
    <div style={{ display: "grid", gap: 6 }}>
      <div className="skeleton" style={{ height: 13, width: "40%", borderRadius: 4 }} />
      <div className="skeleton" style={{ height: 44, borderRadius: 10 }} />
    </div>
  );

  return (
    <div className="page-main wrap">
      <PageHeader title={t("pageTitle")} subtitle={t("pageSubtitle")} />
      <div className="card" aria-label={t("loadingLabel")} style={{ marginTop: 16 }}>
        <div className="pad" style={{ display: "grid", gap: 20 }}>
          <div
            style={{
              display: "grid",
              gap: 14,
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            }}
          >
            {fieldSkeleton}
            {fieldSkeleton}
            {fieldSkeleton}
            {fieldSkeleton}
          </div>
          <div style={{ borderTop: "1px solid var(--line)", paddingTop: 20 }}>
            <div className="skeleton" style={{ height: 15, width: "30%", marginBottom: 16, borderRadius: 4 }} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 16 }}>
              {fieldSkeleton}
              {fieldSkeleton}
              {fieldSkeleton}
              {fieldSkeleton}
              {fieldSkeleton}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
