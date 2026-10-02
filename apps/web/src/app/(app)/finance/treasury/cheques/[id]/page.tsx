import { PageHeader, StatGrid, StatCard, StatusPill, Card, EmptyState, LoadErrorState } from "@/app/_components/ds";
import { getFinanceChequeById } from "@/app/_data/loaders";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import type { FinanceInstrumentSummary } from "@civitasone/types";

type TimelineRow = { date: string; event: string };

/** Built from the instrument's real lifecycle timestamps — issued -> presented -> cleared|bounced|cancelled. */
function timelineOf(c: FinanceInstrumentSummary): TimelineRow[] {
  const rows: TimelineRow[] = [];
  if (c.issueDate) rows.push({ date: formatIndianDate(c.issueDate), event: "Instrument issued" });
  if (c.presentedAt) rows.push({ date: formatIndianDate(c.presentedAt), event: "Presented at bank" });
  if (c.clearedAt) rows.push({ date: formatIndianDate(c.clearedAt), event: "Cleared by bank" });
  if (c.bouncedAt) {
    rows.push({ date: formatIndianDate(c.bouncedAt), event: c.bounceReason ? `Bounced — ${c.bounceReason}` : "Bounced" });
  }
  if (c.cancelledAt) rows.push({ date: formatIndianDate(c.cancelledAt), event: "Cancelled" });
  return rows;
}

/**
 * Cheque / DD detail. Reads the typed FinanceInstrumentSummary contract
 * (finance-service instruments routes) directly.
 *
 * GAP-FINANCE-TREASURY-CHEQUES-DETAIL-02: only a real 404 means "not found";
 * any other failed load is an outage the user can retry, and a 403 is a
 * permission decision.
 *
 * GAP-FINANCE-TREASURY-CHEQUES-DETAIL-01: this page used to print
 * `accountNo ?? bankAccountNumber` in clear text to every finance role. The
 * instrument API carries no bank account NUMBER at all (only an opaque
 * bankAccountId), so that row could only ever show "—" today -- and would have
 * leaked the full number to audit/budget roles the day a backend added the
 * field. The row is removed and the page reads typed fields only, so an
 * account number can never be rendered here by accident. A role-gated, audited
 * "reveal" needs a backend endpoint that does not exist yet.
 */
export default async function ChequeDetailPage({ params }: { params: { id: string } }) {
  const result = await getFinanceChequeById(params.id);
  const { data: cheque, source, status } = result;

  if (source === "error" && status !== 404) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Cheque Detail" back="/finance/treasury/cheques" />
        <LoadErrorState result={result} area="cheque" backHref="/finance/treasury/cheques" />
      </div>
    );
  }

  if (!cheque) {
    return (
      <div className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Cheque Detail" back="/finance/treasury/cheques" />
        <EmptyState icon="🏦" title="Cheque not found" message="This cheque may have been removed or the ID is invalid." />
      </div>
    );
  }

  const timeline = timelineOf(cheque);

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={`Cheque #${cheque.instrumentNo}`}
        subtitle={cheque.payee || undefined}
        back="/finance/treasury/cheques"
      />
      <StatGrid>
        <StatCard icon="₹" iconBg="#ecfdf3" label="Amount" value={formatMoney(cheque.amountMinor)} />
        <StatCard icon="🏦" iconBg="#e7edfd" label="Bank" value={cheque.bankName} />
        <StatCard icon="📅" iconBg="#fffaeb" label="Issue Date" value={formatIndianDate(cheque.issueDate)} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Status" value={cheque.status} />
      </StatGrid>

      <Card title="Cheque Details" padding>
        <div className="fields">
          <div className="field"><span className="label">Cheque No</span><span className="mono">{cheque.instrumentNo}</span></div>
          <div className="field"><span className="label">Type</span><span>{cheque.instrumentType.toUpperCase()}</span></div>
          <div className="field"><span className="label">Payee</span><span>{cheque.payee}</span></div>
          <div className="field"><span className="label">Amount</span><span>{formatMoney(cheque.amountMinor)}</span></div>
          <div className="field"><span className="label">Bank</span><span>{cheque.bankName}</span></div>
          <div className="field"><span className="label">Status</span><StatusPill status={cheque.status} /></div>
          <div className="field"><span className="label">Cleared Date</span><span>{formatIndianDate(cheque.clearedAt)}</span></div>
          {cheque.bounceReason ? (
            <div className="field"><span className="label">Bounce Reason</span><span>{cheque.bounceReason}</span></div>
          ) : null}
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
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
