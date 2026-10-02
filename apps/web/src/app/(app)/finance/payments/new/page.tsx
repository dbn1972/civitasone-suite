import { getTranslations } from "next-intl/server";
import { PageHeader, LoadErrorState } from "@/app/_components/ds";
import { getFinanceBills, getFinanceDdos } from "@/app/_data/loaders";
import { NewPaymentForm } from "./NewPaymentForm";

export default async function NewPaymentPage({ searchParams }: { searchParams?: { billId?: string } }) {
  const t = await getTranslations("financePaymentForm");
  const [bills, ddos] = await Promise.all([getFinanceBills(), getFinanceDdos()]);
  const failed = [bills, ddos].find((r) => r.source === "error" && r.data.length === 0);
  // Only a bill that has been passed (and not yet paid) can be paid. finance-service
  // emits status "passed" for it (payments/queries.ts mapBillStatus).
  const payable = bills.data
    .filter((b) => b.status === "passed")
    .map((b) => ({ id: b.id, billNo: b.billNo, vendor: b.vendor, amount: b.amount }));
  return (
    <>
      <PageHeader title={t("pageTitle")} subtitle={t("pageSubtitle")} back="/finance/payments" backLabel={t("backLabel")} />
      {failed ? (
        <LoadErrorState result={failed} area={t("loadFailedArea")} backHref="/finance/payments" />
      ) : (
        <NewPaymentForm
          bills={payable}
          ddos={ddos.data.map((d) => ({ id: d.ddoCode, label: `${d.ddoCode} — ${d.name}` }))}
          initialBillId={searchParams?.billId}
        />
      )}
    </>
  );
}
