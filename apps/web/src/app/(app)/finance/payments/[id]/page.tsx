import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, Card, StatCard, StatGrid, StatusPill, EmptyState } from "@/app/_components/ds";
import { getFinancePaymentById } from "@/app/_data/loaders";
import { RaiseEOfficeNote } from "@/app/_components/RaiseEOfficeNote";
import { formatMoney } from "@/lib/formatters";

function field(data: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return "—";
}

/** Best-effort minor-unit amount from a loosely-typed record (number | numeric string | bigint). */
function amountMinorOf(data: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "bigint") return Number(v);
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  }
  return undefined;
}

export default async function PaymentDetailPage({ params }: { params: { id: string } }) {
  const { data: payment, source } = await getFinancePaymentById(params.id);

  if (!payment) {
    return (
      <>
        <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
          <a href="/finance">Finance</a> <span aria-hidden="true">›</span>{" "}
          <a href="/finance/payments">Payments</a> <span aria-hidden="true">›</span> Not found
        </nav>
        <PageHeader title="Payment Detail" back="/finance/payments" />
        <EmptyState icon="💸" title="Payment not found" message="This payment may have been removed or the ID is invalid." />
      </>
    );
  }

  const paymentNo = field(payment, "eftRef", "referenceId", "utr") !== "—"
    ? field(payment, "eftRef", "referenceId", "utr")
    : `PAY-${params.id.slice(-6).toUpperCase()}`;
  const status = field(payment, "status");
  const mode = field(payment, "mode");
  const currency = field(payment, "currency");
  const amountMinor = amountMinorOf(payment, "amountMinor", "amount");

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
          <>
            <StatusPill status={status} />
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="₹" iconBg="#ecfdf5" label="Amount" value={amountMinor != null ? formatMoney(amountMinor) : "—"} />
        <StatCard icon="📋" iconBg="#eff6ff" label="Status" value={status.replace(/_/g, " ")} />
        <StatCard icon="🏦" iconBg="#faf5ff" label="Mode" value={mode} />
        <StatCard icon="💱" iconBg="#fff7ed" label="Currency" value={currency} />
      </StatGrid>

      <Card title="Payment details" padding>
        <div className="fields">
          <div className="field"><span className="label">Payment Ref</span><span className="mono">{paymentNo}</span></div>
          <div className="field"><span className="label">Amount</span><span>{amountMinor != null ? formatMoney(amountMinor) : "—"}</span></div>
          <div className="field"><span className="label">Mode</span><span>{mode}</span></div>
          <div className="field"><span className="label">Currency</span><span>{currency}</span></div>
          <div className="field"><span className="label">UTR</span><span className="mono">{field(payment, "utr")}</span></div>
          <div className="field"><span className="label">Status</span><StatusPill status={status} /></div>
        </div>
      </Card>

      <RaiseEOfficeNote
        refType="finance_payment"
        refId={params.id}
        subject={`Payment ${paymentNo}`}
        dept="Finance"
        defaultApprovalChain="file_noting"
        notifyPath={`/api/proxy/v1/finance/payments/${params.id}/submit-approval`}
        {...(amountMinor != null ? { amountMinor } : {})}
      />
    </>
  );
}
