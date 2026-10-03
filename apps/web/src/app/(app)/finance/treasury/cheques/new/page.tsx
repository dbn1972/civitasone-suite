import { getTranslations } from "next-intl/server";
import { PageHeader, EmptyState } from "@/app/_components/ds";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { canWrite } from "@/lib/finance/writeRoles";
import { INSTRUMENT_WRITE_ROLES } from "../[id]/chequeUi";
import { IssueChequeForm } from "./IssueChequeForm";

/** GAP-FINANCE-TREASURY-CHEQUES-03: Issue a cheque / DD (finance write roles only). */
export default async function IssueChequePage() {
  const t = await getTranslations("financeChequesNew");
  const allowed = canWrite(getSessionRoles(), INSTRUMENT_WRITE_ROLES);
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/finance/treasury/cheques" backLabel={t("backLabel")} />
      {allowed ? (
        <IssueChequeForm />
      ) : (
        <EmptyState icon="🔒" title={t("noAccessTitle")} message={t("noAccessMessage")} />
      )}
    </div>
  );
}
