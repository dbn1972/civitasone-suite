import { getTranslations } from "next-intl/server";
import { PageHeader, Card, StatCard, StatGrid, StatusPill, EmptyState, LoadErrorState } from "../../../../../_components/ds";
import { getFinanceBillById } from "../../../../../_data/loaders";
import { formatIndianDate, formatMoney, formatInternalRef, humanizeStatus } from "@/lib/formatters";
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
          <nav aria-label={t("breadcrumbLabel")} className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
            <a href="/finance/expenditure/bills">{t("breadcrumbBills")}</a>
          </nav>
          <PageHeader title={t("titleLoadFailed")} back="/finance/expenditure/bills" />
          <LoadErrorState result={result} area={t("areaBill")} backHref="/finance/expenditure/bills" />
        </>
      );
    }
    return (
      <>
        <nav aria-label={t("breadcrumbLabel")} className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
          <a href="/finance/expenditure/bills">{t("breadcrumbBills")}</a> <span aria-hidden="true">›</span> {t("notFound")}
        </nav>
        <PageHeader title={t("titleNotFound")} back="/finance/expenditure/bills" />
        <EmptyState icon="🧮" title={t("emptyTitleNotFound")} message={t("emptyMessageNotFound")} />
      </>
    );
  }

  return (
    <>
      <nav aria-label={t("breadcrumbLabel")} className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
        <a href="/finance">{t("breadcrumbFinance")}</a> <span aria-hidden="true">›</span>{" "}
        <a href="/finance/expenditure/bills">{t("breadcrumbBills")}</a> <span aria-hidden="true">›</span>{" "}
        <span aria-current="page">{bill.billNo}</span>
      </nav>

      <PageHeader
        title={bill.billNo}
        subtitle={bill.vendor}
        back="/finance/expenditure/bills"
        actions={
          <>
            <StatusPill status={bill.status} />
            <BillPassPayActions id={params.id} status={bill.status} threeWayMatch={bill.threeWayMatch} />
          </>
        }
      />

      <StatGrid>
        <StatCard icon="₹" iconBg="#ecfdf5" label={t("amount")} value={formatMoney(bill.amount)} />
        <StatCard icon="📋" iconBg="#eff6ff" label={t("status")} value={humanizeStatus(bill.status)} />
        <StatCard icon="🏢" iconBg="#faf5ff" label={t("vendor")} value={bill.vendor} />
        <StatCard icon="📅" iconBg="#fff7ed" label={t("date")} value={formatIndianDate(bill.submittedDate)} />
      </StatGrid>

      <Card title={t("cardTitleDetails")} padding>
        <div className="fields">
          <div className="field"><span className="label">{t("fieldBillNo")}</span><span className="mono">{bill.billNo}</span></div>
          <div className="field"><span className="label">{t("vendor")}</span><span>{bill.vendor}</span></div>
          <div className="field"><span className="label">{t("amount")}</span><span>{formatMoney(bill.amount)}</span></div>
          <div className="field"><span className="label">{t("fieldPoRef")}</span><span>{formatInternalRef(bill.poRef)}</span></div>
          <div className="field"><span className="label">{t("fieldGrnRef")}</span><span>{formatInternalRef(bill.grnRef)}</span></div>
          <div className="field"><span className="label">{t("fieldInvoiceNo")}</span><span>{bill.invoiceNo ?? "—"}</span></div>
          <div className="field"><span className="label">{t("fieldSubmitted")}</span><span>{formatIndianDate(bill.submittedDate)}</span></div>
          <div className="field"><span className="label">{t("fieldDueDate")}</span><span>{bill.dueDate ? formatIndianDate(bill.dueDate) : "—"}</span></div>
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
