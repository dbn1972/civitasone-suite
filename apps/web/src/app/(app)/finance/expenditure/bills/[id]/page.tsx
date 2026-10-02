import { getTranslations } from "next-intl/server";
import { PageHeader, Card, StatCard, StatGrid, StatusPill, EmptyState, LoadErrorState } from "../../../../../_components/ds";
import { getFinanceBillById } from "../../../../../_data/loaders";
import { formatIndianDate, formatMoney, formatEntityRef } from "@/lib/formatters";
import { canWrite, BILL_APPROVE_ROLES } from "@/lib/finance/writeRoles";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { BillPassPayActions } from "../../../_components/FinanceActions";
import { BillLineItemsTable } from "./BillLineItemsTable";

export default async function BillDetailPage({ params }: { params: { id: string } }) {
  const t = await getTranslations("expenditureBillDetail");
  const result = await getFinanceBillById(params.id);
  const { data: bill } = result;

  if (!bill) {
    // A failed load is not "bill not found" (GAP-FINANCE-EXPENDITURE-BILLS-DETAIL-01):
    // only a real 404 says the bill does not exist; 403 -> permission denied,
    // anything else -> retryable error state.
    if (result.source === "error" && result.status !== 404) {
      return (
        <>
          <PageHeader title={t("titleLoadFailed")} back="/finance/expenditure/bills" />
          <LoadErrorState result={result} area={t("areaBill")} backHref="/finance/expenditure/bills" />
        </>
      );
    }
    return (
      <>
        <PageHeader title={t("titleNotFound")} back="/finance/expenditure/bills" />
        <EmptyState icon="🧮" title={t("emptyTitleNotFound")} message={t("emptyMessageNotFound")} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={bill.billNo}
        subtitle={bill.vendor}
        back="/finance/expenditure/bills"
        actions={
          <>
            <StatusPill status={bill.status} />
            <BillPassPayActions
              id={params.id}
              status={bill.status}
              threeWayMatch={bill.threeWayMatch}
              canPass={canWrite(getSessionRoles(), BILL_APPROVE_ROLES)}
            />
          </>
        }
      />

      <StatGrid>
        <StatCard icon="₹" iconBg="#ecfdf5" label={t("amount")} value={formatMoney(bill.amount)} />
        <StatCard icon="📅" iconBg="#fff7ed" label={t("fieldSubmitted")} value={formatIndianDate(bill.submittedDate)} />
        <StatCard icon="⏰" iconBg="#fef3f2" label={t("fieldDueDate")} value={bill.dueDate ? formatIndianDate(bill.dueDate) : "—"} />
      </StatGrid>

      <Card title={t("cardTitleDetails")} padding>
        <div className="fields">
          <div className="field"><span className="label">{t("fieldPoRef")}</span><span>{formatEntityRef(bill.poRef)}</span></div>
          <div className="field"><span className="label">{t("fieldGrnRef")}</span><span>{formatEntityRef(bill.grnRef)}</span></div>
          <div className="field"><span className="label">{t("fieldInvoiceNo")}</span><span>{bill.invoiceNo ?? "—"}</span></div>
          <div className="field"><span className="label">{t("fieldThreeWayMatch")}</span><StatusPill status={bill.threeWayMatch} /></div>
          <div className="field"><span className="label">{t("fieldPaymentRef")}</span><span>{bill.paymentRef ?? "—"}</span></div>
        </div>
      </Card>

      {bill.lineItems.length > 0 && (
        <Card title={t("cardTitleLineItems")}>
          <BillLineItemsTable
            rows={bill.lineItems as ({ description: string; quantity: number; unitPrice: number; amount: string; taxCode?: string } & Record<string, unknown>)[]}
          />
        </Card>
      )}
    </>
  );
}
