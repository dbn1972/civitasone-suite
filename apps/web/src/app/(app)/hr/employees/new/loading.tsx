import { SkeletonBar } from "@/app/_components/ds/Skeleton";
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
      <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 24, display: "grid", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "16px 24px" }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ display: "grid", gap: 6 }}>
              <SkeletonBar w="40%" h={13} style={{ borderRadius: 4 }} />
              <SkeletonBar h={44} style={{ borderRadius: 8 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
