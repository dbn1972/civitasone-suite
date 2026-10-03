import { notFound } from "next/navigation";
import { PageHeader, Card, StatCard, StatGrid, StatusPill, LoadErrorState, EmptyState } from "@/app/_components/ds";
import { getFinanceActorNames, getFinancePaymentById, getFinancePaymentContext } from "@/app/_data/loaders";
import { actorLabel } from "@/lib/finance/workflowTypes";
import { RaiseEOfficeNote } from "@/app/_components/RaiseEOfficeNote";
import { formatIndianDateTime, formatMoney } from "@/lib/formatters";
import { canRaiseForApproval, formatPaymentRef, hasPaymentHistory, paymentStatusVariant } from "../paymentUi";

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

  // GAP-FINANCE-PAYMENTS-DETAIL-04: beneficiary, linked bill, approver and status history come from the
  // payment context endpoint. A failed lookup is its own state (never "no history"), and the page still
  // renders what the base payment carries.
  const ctxResult = await getFinancePaymentContext(params.id);
  const ctx = ctxResult.data;
  const names = await getFinanceActorNames([
    field(payment, "createdBy") === "—" ? null : field(payment, "createdBy"),
    ctx?.approvedBy, ...(ctx?.events.map((e) => e.actorId) ?? []),
  ]);
  const billNo = ctx?.bill?.billNo ?? null;

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
            <span className="label">Beneficiary</span>
            {ctx?.beneficiary ? <a href={`/finance/vendors/${ctx.beneficiary.vendorId}`}>{ctx.beneficiary.name}</a> : <span>—</span>}
          </div>
          <div className="field">
            <span className="label">Bill</span>
            {billId !== "—" ? (
              <a href={`/finance/expenditure/bills/${billId}`}>{billNo ?? "View bill"}</a>
            ) : (
              <span>—</span>
            )}
          </div>
          <div className="field"><span className="label">Created by</span><span>{actorLabel(field(payment, "createdBy") === "—" ? null : field(payment, "createdBy"), names)}</span></div>
          <div className="field"><span className="label">Approved by</span><span>{actorLabel(ctx?.approvedBy, names)}</span></div>
          <div className="field"><span className="label">Created</span><span>{createdAt !== "—" ? formatIndianDateTime(createdAt) : "—"}</span></div>
        </div>
      </Card>

      <Card title="Status history">
        {ctxResult.source === "error" && !ctx ? (
          <LoadErrorState result={ctxResult} area="payment history" backHref="/finance/payments" />
        ) : !hasPaymentHistory(ctx) ? (
          <EmptyState icon="🕒" title="No history recorded" message="No status changes have been recorded for this payment." />
        ) : (
          <ol style={{ listStyle: "none", padding: 0, margin: 0 }} aria-label="Payment status history">
            {ctx.events.map((e, i) => (
              <li key={i} style={{ display: "flex", gap: 12, alignItems: "center", padding: "8px 0", borderBottom: i < ctx.events.length - 1 ? "1px solid var(--border)" : "none" }}>
                <span style={{ minWidth: 150, fontSize: 13, color: "var(--muted)" }}>{formatIndianDateTime(e.at)}</span>
                <StatusPill status={e.status} {...(paymentStatusVariant(e.status) ? { variant: paymentStatusVariant(e.status)! } : {})} />
                <span style={{ flex: 1, fontSize: 13 }}>{actorLabel(e.actorId, names)}{e.note ? ` — ${e.note}` : ""}</span>
              </li>
            ))}
          </ol>
        )}
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
