import { SkeletonTable } from "../../../_components/ds";
import { PageHeader } from "../../../_components/ds";
import { getTranslations } from "next-intl/server";

export default async function PayrollLoading() {
  const t = await getTranslations("payroll");
  // GAP-PAYROLL-HOME-08: this used to title the skeleton "Payroll Runs" with
  // a back link to /hr (runsCardTitle), while the loaded page titles itself
  // "Payroll" with no back link (page.tsx) -- the heading visibly changed
  // the moment data arrived. Mirror page.tsx exactly.
  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
      />
      <div className="page-main wrap">
        <SkeletonTable rows={6} />
      </div>
    </>
  );
}
