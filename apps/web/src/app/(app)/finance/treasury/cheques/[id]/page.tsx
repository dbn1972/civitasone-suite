import { PageHeader, StatGrid, StatCard, StatusPill, Card, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { getFinanceChequeById } from "@/app/_data/loaders";
import { formatMoney, formatIndianDate } from "@/lib/formatters";

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

type TimelineRow = { date: string; event: string; actor: string };

/** Built from the instrument's real lifecycle timestamps — issued -> presented -> cleared|bounced|cancelled. */
function timelineOf(data: Record<string, unknown>): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const issueDate = field(data, "issueDate");
  if (issueDate !== "—") rows.push({ date: formatIndianDate(issueDate), event: "Instrument issued", actor: "—" });
  const presentedAt = field(data, "presentedAt");
  if (presentedAt !== "—") rows.push({ date: formatIndianDate(presentedAt), event: "Presented at bank", actor: "—" });
  const clearedAt = field(data, "clearedAt");
  if (clearedAt !== "—") rows.push({ date: formatIndianDate(clearedAt), event: "Cleared by bank", actor: "—" });
  const bouncedAt = field(data, "bouncedAt");
  if (bouncedAt !== "—") {
    const reason = field(data, "bounceReason");
    rows.push({ date: formatIndianDate(bouncedAt), event: reason !== "—" ? `Bounced — ${reason}` : "Bounced", actor: "—" });
  }
  const cancelledAt = field(data, "cancelledAt");
  if (cancelledAt !== "—") rows.push({ date: formatIndianDate(cancelledAt), event: "Cancelled", actor: "—" });
  return rows;
}

export default async function ChequeDetailPage({ params }: { params: { id: string } }) {
  const { data: cheque, source } = await getFinanceChequeById(params.id);

  if (!cheque) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Cheque Detail" back="/finance/treasury/cheques" />
        <EmptyState icon="🏦" title="Cheque not found" message="This cheque may have been removed or the ID is invalid." />
      </main>
    );
  }

  const chequeNo = field(cheque, "instrumentNo", "chequeNo");
  const payee = field(cheque, "payee");
  const status = field(cheque, "status");
  const bankName = field(cheque, "bankName", "bank");
  const issueDate = field(cheque, "issueDate", "date");
  const amountMinor = amountMinorOf(cheque, "amountMinor", "amount");
  const timeline = timelineOf(cheque);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={`Cheque #${chequeNo}`}
        subtitle={payee !== "—" ? payee : undefined}
        back="/finance/treasury/cheques"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="₹" iconBg="#ecfdf3" label="Amount" value={amountMinor !== undefined ? formatMoney(amountMinor) : "—"} />
        <StatCard icon="🏦" iconBg="#e7edfd" label="Bank" value={bankName} />
        <StatCard icon="📅" iconBg="#fffaeb" label="Issue Date" value={formatIndianDate(issueDate)} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Status" value={status} />
      </StatGrid>

      <Card title="Cheque Details" padding>
        <div className="fields">
          <div className="field"><span className="label">Cheque No</span><span className="mono">{chequeNo}</span></div>
          <div className="field"><span className="label">Payee</span><span>{payee}</span></div>
          <div className="field"><span className="label">Amount</span><span>{amountMinor !== undefined ? formatMoney(amountMinor) : "—"}</span></div>
          <div className="field"><span className="label">Bank & Branch</span><span>{bankName} — {field(cheque, "branch")}</span></div>
          <div className="field"><span className="label">Account No</span><span className="mono">{field(cheque, "accountNo", "bankAccountNumber")}</span></div>
          <div className="field"><span className="label">Status</span><StatusPill status={status} /></div>
          <div className="field"><span className="label">Issued By</span><span>{field(cheque, "issuedBy")}</span></div>
          <div className="field"><span className="label">Cleared Date</span><span>{formatIndianDate(field(cheque, "clearedAt", "clearedDate"))}</span></div>
          <div className="field"><span className="label">Purpose</span><span>{field(cheque, "purpose", "remarks", "narration")}</span></div>
        </div>
      </Card>

      <Card title="Clearance Timeline" padding>
        {timeline.length === 0 ? (
          <EmptyState icon="🕒" title="No timeline recorded" message="No lifecycle events have been recorded for this instrument." />
        ) : (
          <ol style={{ listStyle: "none", padding: 0, margin: 0 }} aria-label="Cheque clearance timeline">
            {timeline.map((item, i) => (
              <li key={i} style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: i < timeline.length - 1 ? "1px solid var(--border)" : "none" }}>
                <span style={{ minWidth: 100, fontSize: 13, color: "var(--muted)" }}>{item.date}</span>
                <span style={{ flex: 1 }}>{item.event}</span>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>{item.actor}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </main>
  );
}
