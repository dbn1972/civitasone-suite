import { getTranslations } from "next-intl/server";
import { PageHeader, SkeletonTable } from "../../../../_components/ds";

// GAP-PAYROLL-ARREARS-06: page-shaped skeleton (header + 4 stat cards +
// register table, via SkeletonTable) instead of one unlabeled block.
export default async function Loading() {
  const t = await getTranslations("arrears");
  return (
    <div className="page-main wrap" aria-busy="true" aria-label={t("loadingAriaLabel")}>
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/payroll" backLabel={t("backLabel")} />
      <SkeletonTable rows={8} />
    </div>
  );
}
