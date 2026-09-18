import { getTranslations } from "next-intl/server";
import { DataSourceBadge } from "../../../../../_components/DataSourceBadge";
import { PageHeader, Card, StatCard, StatGrid, StatusPill, EmptyState } from "../../../../../_components/ds";
import { getFinanceBillById } from "../../../../../_data/loaders";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import { BillPassPayActions } from "../../../_components/FinanceActions";
import { BillLineItemsTable } from "./BillLineItemsTable";

export default async function BillDetailPage({ params }: { params: { id: string } }) {
  const t = await getTranslations("expenditureBillDetail");
  const { data: bill, source } = await getFinanceBillById(params.id);

  if (!bill) {
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
            <StatusPill status={bill.status} label={bill.status.replace("_", " ")} />
            <BillPassPayActions id={params.id} status={bill.status} />
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="₹" iconBg="#ecfdf5" label={t("amount")} value={formatMoney(bill.amount)} />
        <StatCard icon="📋" iconBg="#eff6ff" label={t("status")} value={bill.status.replace(/_/g, " ")} />
        <StatCard icon="🏢" iconBg="#faf5ff" label={t("vendor")} value={bill.vendor} />
        <StatCard icon="📅" iconBg="#fff7ed" label={t("date")} value={formatIndianDate(bill.submittedDate)} />
      </StatGrid>

      <Card title={t("cardTitleDetails")} padding>
        <div className="fields">
          <div className="field"><span className="label">{t("fieldBillNo")}</span><span className="mono">{bill.billNo}</span></div>
          <div className="field"><span className="label">{t("vendor")}</span><span>{bill.vendor}</span></div>
          <div className="field"><span className="label">{t("amount")}</span><span>{formatMoney(bill.amount)}</span></div>
          <div className="field"><span className="label">{t("fieldPoRef")}</span><span>{bill.poRef ?? "—"}</span></div>
          <div className="field"><span className="label">{t("fieldGrnRef")}</span><span>{bill.grnRef ?? "—"}</span></div>
          <div className="field"><span className="label">{t("fieldInvoiceNo")}</span><span>{bill.invoiceNo ?? "—"}</span></div>
          <div className="field"><span className="label">{t("fieldSubmitted")}</span><span>{formatIndianDate(bill.submittedDate)}</span></div>
          <div className="field"><span className="label">{t("fieldDueDate")}</span><span>{bill.dueDate ? formatIndianDate(bill.dueDate) : "—"}</span></div>
          <div className="field"><span className="label">{t("fieldThreeWayMatch")}</span><StatusPill status={bill.threeWayMatch} label={bill.threeWayMatch.replace("_", " ")} /></div>
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
