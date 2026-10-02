import { notFound } from "next/navigation";
import { PageHeader, Card, StatCard, StatGrid, StatusPill, LoadErrorState } from "@/app/_components/ds";
import { getFinancePaymentById } from "@/app/_data/loaders";
import { RaiseEOfficeNote } from "@/app/_components/RaiseEOfficeNote";
import { formatIndianDateTime, formatMoney } from "@/lib/formatters";
import { canRaiseForApproval, formatPaymentRef, paymentStatusVariant } from "../paymentUi";

function field(data: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return "—";
}

/** Minor-unit amount as an exact base-10 string (API sends a string; never Number() it). */
function amountMinorOf(data: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "bigint") return v.toString();
    if (typeof v === "number" && Number.isSafeInteger(v)) return String(v);
    if (typeof v === "string" && /^\d+$/.test(v.trim())) return v.trim();
  }
  return undefined;
}

export default async function PaymentDetailPage({ params }: { params: { id: string } }) {
  const result = await getFinancePaymentById(params.id);
  const { data: payment } = result;

  if (!payment) {
    // A failed load is not "not found" (GAP-FINANCE-PAYMENTS-DETAIL-01): only a
    // real 404 says the payment does not exist.
    if (result.source === "error" && result.status !== 404) {
      return (
        <>
          <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
            <a href="/finance">Finance</a> <span aria-hidden="true">›</span>{" "}
            <a href="/finance/payments">Payments</a> <span aria-hidden="true">›</span> Unavailable
          </nav>
          <PageHeader title="Payment Detail" back="/finance/payments" />
          <LoadErrorState result={result} area="payment" backHref="/finance/payments" />
        </>
      );
    }
    // GAP-FINANCE-PAYMENTS-DETAIL-05: a real 404 is the finance route-level not-found page.
    notFound();
  }

  // GAP-FINANCE-PAYMENTS-DETAIL-06: same derivation as the register (shared formatPaymentRef),
  // so a payment shows one reference on both screens.
  const refRaw = field(payment, "eftRef", "referenceId");
  const paymentNo = formatPaymentRef(refRaw === "—" ? null : refRaw, params.id);
  const status = field(payment, "status");
  const mode = field(payment, "mode");
  const currency = field(payment, "currency");
  const amountMinor = amountMinorOf(payment, "amountMinor", "amount");
  const billId = field(payment, "billId");
  const createdAt = field(payment, "createdAt");
  const pillVariant = paymentStatusVariant(status);

  return (
    <>
      <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
        <a href="/finance">Finance</a> <span aria-hidden="true">›</span>{" "}
        <a href="/finance/payments">Payments</a> <span aria-hidden="true">›</span>{" "}
        <span aria-current="page">{paymentNo}</span>
      </nav>

      <PageHeader
        title={paymentNo}
        subtitle={mode !== "—" ? `Payment via ${mode}` : undefined}
        back="/finance/payments"
        actions={
          <StatusPill status={status} {...(pillVariant ? { variant: pillVariant } : {})} />
        }
      />

      <StatGrid>
        <StatCard icon="₹" iconBg="#ecfdf5" label="Amount" value={amountMinor != null ? formatMoney(amountMinor) : "—"} />
        <StatCard icon="🏦" iconBg="#faf5ff" label="Mode" value={mode} />
        <StatCard icon="💱" iconBg="#fff7ed" label="Currency" value={currency} />
        <StatCard icon="🗓️" iconBg="#eff6ff" label="Created" value={createdAt !== "—" ? formatIndianDateTime(createdAt) : "—"} />
      </StatGrid>

      <Card title="Payment details" padding>
        <div className="fields">
          <div className="field"><span className="label">Payment Ref</span><span className="mono">{paymentNo}</span></div>
          <div className="field"><span className="label">Amount</span><span>{amountMinor != null ? formatMoney(amountMinor) : "—"}</span></div>
          <div className="field"><span className="label">Mode</span><span>{mode}</span></div>
          <div className="field"><span className="label">Currency</span><span>{currency}</span></div>
          <div className="field"><span className="label">UTR</span><span className="mono">{field(payment, "utr")}</span></div>
          <div className="field">
            <span className="label">Bill</span>
            {billId !== "—" ? (
              <a href={`/finance/expenditure/bills/${billId}`}>View bill</a>
            ) : (
              <span>—</span>
            )}
          </div>
          <div className="field"><span className="label">Created</span><span>{createdAt !== "—" ? formatIndianDateTime(createdAt) : "—"}</span></div>
        </div>
      </Card>

      {/* GAP-FINANCE-PAYMENTS-DETAIL-03: a released / failed / already-submitted payment cannot be
          raised for approval (the API 409s it), so the action is only offered for open payments. */}
      {canRaiseForApproval(status) ? (
        <RaiseEOfficeNote
          refType="finance_payment"
          refId={params.id}
          subject={`Payment ${paymentNo}`}
          dept="Finance"
          defaultApprovalChain="file_noting"
          notifyPath={`/api/proxy/v1/finance/payments/${params.id}/submit-approval`}
          {...(amountMinor != null ? { amountMinor } : {})}
        />
      ) : null}
    </>
  );
}
