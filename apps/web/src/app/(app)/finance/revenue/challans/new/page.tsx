import { getTranslations } from "next-intl/server";
import { PageHeader, EmptyState, LoadErrorState } from "@/app/_components/ds";
import { getFinanceBillHeads } from "@/app/_data/loaders";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { canWrite } from "@/lib/finance/writeRoles";
import { RecordChallanForm } from "./RecordChallanForm";

/** GAP-FINANCE-REVENUE-CHALLANS-06: Record a challan (finance write roles only). */
export default async function RecordChallanPage() {
  const t = await getTranslations("financeChallansNew");
  const allowed = canWrite(getSessionRoles(), ["finance_officer", "finance_admin", "super_admin"]);
  const heads = allowed ? await getFinanceBillHeads() : null;
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/finance/revenue/challans" backLabel={t("backLabel")} />
      {!allowed ? (
        <EmptyState icon="🔒" title={t("noAccessTitle")} message={t("noAccessMessage")} />
      ) : heads && heads.source === "error" ? (
        <LoadErrorState result={heads} area="receipt heads" backHref="/finance/revenue/challans" />
      ) : (
        <RecordChallanForm heads={heads?.data ?? []} />
      )}
    </div>
  );
}
