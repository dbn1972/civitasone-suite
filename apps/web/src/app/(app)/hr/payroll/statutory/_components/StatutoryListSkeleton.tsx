import { getTranslations } from "next-intl/server";
import { PageHeader, SkeletonBar, SkeletonTable } from "../../../../../_components/ds";

/**
 * GAP-PAYROLL-STATUTORY-ESI-05: shared loading shell for the statutory ledger
 * pages (pf / esi / nps / lwf / pt / challans / gratuity): the page's real header, four stat-tile
 * placeholders and a table skeleton, instead of one blank grey block with no
 * page frame. `namespace` is the page's own next-intl namespace (it supplies
 * title, subtitle, loadingAriaLabel and a back label).
 */
export async function StatutoryListSkeleton({ namespace }: { namespace: string }) {
  const t = await getTranslations(namespace);
  const backLabel = t.has("errorBackLabel") ? t("errorBackLabel") : t.has("backToStatutoryLabel") ? t("backToStatutoryLabel") : "";
  return (
    <div className="page-main wrap" aria-labelledby="page-heading" aria-busy="true">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/payroll/statutory" backLabel={backLabel} />
      <div role="status" aria-label={t("loadingAriaLabel")}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 16 }}>
          {[0, 1, 2, 3].map((i) => (
            <SkeletonBar key={i} h={72} style={{ borderRadius: 12 }} />
          ))}
        </div>
        <SkeletonTable rows={6} />
      </div>
    </div>
  );
}
