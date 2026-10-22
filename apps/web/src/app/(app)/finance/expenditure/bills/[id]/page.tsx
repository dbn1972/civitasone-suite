import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader, Card, StatCard, StatGrid, StatusPill, EmptyState, LoadErrorState } from "../../../../../_components/ds";
import { getFinanceBillById } from "../../../../../_data/loaders";
import { formatIndianDate, formatMoney, formatEntityRef } from "@/lib/formatters";
import { billPoHref, billPoLabel } from "@/lib/finance/billRefs";
import { canWrite, BILL_APPROVE_ROLES, PAYMENT_RELEASE_ROLES } from "@/lib/finance/writeRoles";
import { getSessionRoles, getSessionUserId } from "@/lib/auth/roleGuard";
import { BillPassPayActions } from "../../../_components/FinanceActions";
import { ScannedDocumentsSection } from "../../../_components/scanned/ScannedDocumentsSection";
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

  const roles = getSessionRoles();
  const poHref = billPoHref(bill);

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
              canPass={canWrite(roles, BILL_APPROVE_ROLES)}
              canRelease={canWrite(roles, PAYMENT_RELEASE_ROLES)}
              // Maker-checker (GAP-FINANCE-EXPENDITURE-BILLS-DETAIL-03): withhold what the server would 409.
              viewerId={getSessionUserId()}
              createdBy={bill.createdBy ?? null}
              passedBy={bill.passedBy ?? null}
            />
          </>
        }
      />

      <StatGrid>
        <StatCard icon="₹" tone="good" label={t("amount")} value={formatMoney(bill.amount)} />
        <StatCard icon="📅" tone="warn" label={t("fieldSubmitted")} value={formatIndianDate(bill.submittedDate)} />
        <StatCard icon="⏰" tone="bad" label={t("fieldDueDate")} value={bill.dueDate ? formatIndianDate(bill.dueDate) : "—"} />
      </StatGrid>

      <Card title={t("cardTitleDetails")} padding>
        <div className="fields">
          <div className="field"><span className="label">{t("fieldPoRef")}</span><span>{poHref ? <Link href={poHref}>{billPoLabel(bill)}</Link> : billPoLabel(bill)}</span></div>
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

      <ScannedDocumentsSection kind="bills" id={params.id} backHref="/finance/expenditure/bills" />
    </>
  );
}
