import { SkeletonBar } from "@/app/_components/ds/Skeleton";
import { PageHeader } from "../../../../_components/ds";
import { getTranslations } from "next-intl/server";

/**
 * GAP-HR-DEPARTMENTS-NEW-05: this was a bare `.skeleton` div with a
 * hard-coded English aria-label ("Loading...") -- no header, no shape
 * resembling the form it precedes. Same pattern as
 * hr/designations/new/loading.tsx (GAP-HR-DESIGNATIONS-NEW-05, already
 * fixed) -- that fix's own PR explicitly flagged this file as the same
 * defect, out of scope for its designations-only lane; this closes it here.
 */
export default async function NewDepartmentLoading() {
  const t = await getTranslations("addDepartmentForm");
  return (
    <div className="page-main wrap">
      <PageHeader title={t("pageTitle")} subtitle={t("pageSubtitle")} />
      <div className="card" aria-label={t("loadingLabel")} style={{ marginTop: 16 }}>
        <div className="pad" style={{ display: "grid", gap: 16 }}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} style={{ display: "grid", gap: 6 }}>
              <SkeletonBar w="30%" h={13} style={{ borderRadius: 4 }} />
              <SkeletonBar h={44} style={{ borderRadius: 8 }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
