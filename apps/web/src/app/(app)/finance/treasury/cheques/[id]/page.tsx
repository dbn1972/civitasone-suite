import { PageHeader, StatGrid, StatCard, StatusPill, Card, EmptyState, LoadErrorState } from "@/app/_components/ds";
import { getFinanceActorNames, getFinanceChequeById } from "@/app/_data/loaders";
import { RevealableValue } from "@/app/_components/ds/RevealableValue";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { BANK_ACCOUNT_REVEAL_ROLES, canWrite } from "@/lib/finance/writeRoles";
import { InstrumentActions } from "./InstrumentActions";
import { InstrumentLifecycleActions } from "./InstrumentLifecycleActions";
import { availableLifecycleActions } from "./lifecycleUi";
import {
  istToday, INSTRUMENT_WRITE_ROLES, buildChequeTimeline, hasTimelineRows, canCancelInstrument, canMarkStale, canRepresentInstrument,
  chequeStatusIcon, chequeStatusLabel, clearedDateLabel, maskedAccountLabel,
} from "./chequeUi";

/**
 * Cheque / DD detail. Reads the typed FinanceInstrumentSummary contract
 * (finance-service instruments routes) directly.
 *
 * GAP-FINANCE-TREASURY-CHEQUES-DETAIL-02: only a real 404 means "not found";
 * any other failed load is an outage the user can retry, and a 403 is a
 * permission decision.
 *
 * GAP-FINANCE-TREASURY-CHEQUES-DETAIL-01: the drawn-on account shows as
 * XXXXXXXX1234 (last four from the API) and only roles in
 * BANK_ACCOUNT_REVEAL_ROLES get a Reveal control, which asks for a reason and calls
 * finance-service's audited reveal endpoint (actor + reason written to the audit
 * trail; the number is never in the page payload and re-masks itself after 30s).
 *
 * GAP-FINANCE-TREASURY-CHEQUES-DETAIL-03: timeline actors come from the explicit
 * per-step actor ids on the instrument (names resolved server-side), and the actor
 * column is hidden when no step has one.
 */
export default async function ChequeDetailPage({ params }: { params: { id: string } }) {
  const result = await getFinanceChequeById(params.id);
  const { data: cheque, source, status } = result;

  if (source === "error" && status !== 404) {
    return (
      <div className="page-main wrap">
        <PageHeader title="Cheque Detail" back="/finance/treasury/cheques" />
        <LoadErrorState result={result} area="cheque" backHref="/finance/treasury/cheques" />
      </div>
    );
  }

  if (!cheque) {
    return (
      <div className="page-main wrap">
        <PageHeader title="Cheque Detail" back="/finance/treasury/cheques" />
        <EmptyState icon="🏦" title="Cheque not found" message="This cheque may have been removed or the ID is invalid." />
      </div>
    );
  }

  const roles = getSessionRoles();
  const names = await getFinanceActorNames([
    cheque.issuedBy, cheque.presentedBy, cheque.clearedBy, cheque.bouncedBy, cheque.cancelledBy, cheque.lastRepresentedBy, cheque.staledBy,
  ]);
  const timeline = buildChequeTimeline(cheque, names);
  const writer = canWrite(roles, INSTRUMENT_WRITE_ROLES);
  const today = istToday();
  const canCancel = writer && canCancelInstrument(cheque.status);
  const canRepresent = writer && canRepresentInstrument(cheque.status);
  const canStale = writer && canMarkStale(cheque.status, cheque.validUntil, today);

  return (
    <div className="page-main wrap">
      <PageHeader
        title={`Cheque #${cheque.instrumentNo}`}
        subtitle={cheque.payee || undefined}
        back="/finance/treasury/cheques"
        actions={
          writer ? (
            <>
              {availableLifecycleActions(cheque.status).length > 0 ? (
                <InstrumentLifecycleActions id={cheque.id} instrumentNo={cheque.instrumentNo} status={cheque.status} />
              ) : null}
              {canCancel || canRepresent || canStale ? (
                <InstrumentActions id={cheque.id} instrumentNo={cheque.instrumentNo} canCancel={canCancel} canRepresent={canRepresent} canStale={canStale} />
              ) : null}
            </>
          ) : null
        }
      />
      <StatGrid>
        <StatCard icon="₹" iconBg="#ecfdf3" label="Amount" value={formatMoney(cheque.amountMinor)} />
        <StatCard icon="🏦" iconBg="#e7edfd" label="Bank" value={cheque.bankName} />
        <StatCard icon="📅" iconBg="#fffaeb" label="Issue Date" value={formatIndianDate(cheque.issueDate)} />
        <StatCard icon={chequeStatusIcon(cheque.status)} iconBg="#ecfdf3" label="Status" value={chequeStatusLabel(cheque.status)} />
      </StatGrid>

      <Card title="Cheque Details" padding>
        <div className="fields">
          <div className="field"><span className="label">Cheque No</span><span className="mono">{cheque.instrumentNo}</span></div>
          <div className="field"><span className="label">Type</span><span>{cheque.instrumentType.toUpperCase()}</span></div>
          <div className="field"><span className="label">Payee</span><span>{cheque.payee}</span></div>
          <div className="field"><span className="label">Amount</span><span>{formatMoney(cheque.amountMinor)}</span></div>
          <div className="field"><span className="label">Bank</span><span>{cheque.bankName}</span></div>
          <div className="field">
            <span className="label">Account No</span>
            <RevealableValue
              maskedText={maskedAccountLabel(cheque.accountNoLast4)}
              revealPath={`v1/finance/instruments/${cheque.id}/reveal-account`}
              pick={(json) => (json as { accountNo?: string })?.accountNo}
              canReveal={!!cheque.bankAccountId && canWrite(roles, BANK_ACCOUNT_REVEAL_ROLES)}
              label="account number"
              fallback="—"
            />
          </div>
          <div className="field"><span className="label">Status</span><StatusPill status={cheque.status} /></div>
          <div className="field"><span className="label">Cleared Date</span><span>{clearedDateLabel(cheque.clearedAt, cheque.status)}</span></div>
          {cheque.bounceReason ? (
            <div className="field"><span className="label">Bounce Reason</span><span>{cheque.bounceReason}</span></div>
          ) : null}
          {cheque.cancelReason ? (
            <div className="field"><span className="label">Cancel Reason</span><span>{cheque.cancelReason}</span></div>
          ) : null}
          {cheque.validUntil ? (
            <div className="field"><span className="label">Valid Until</span><span>{formatIndianDate(cheque.validUntil)}</span></div>
          ) : null}
        </div>
      </Card>

      <Card title="Clearance Timeline" padding>
        {!hasTimelineRows(timeline) ? (
          <EmptyState icon="🕒" title="No timeline recorded" message="No lifecycle events have been recorded for this instrument." />
        ) : (
          <ol style={{ listStyle: "none", padding: 0, margin: 0 }} aria-label="Cheque clearance timeline">
            {timeline.rows.map((item, i) => (
              <li key={i} style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: i < timeline.rows.length - 1 ? "1px solid var(--border)" : "none" }}>
                <span style={{ minWidth: 100, fontSize: 13, color: "var(--muted)" }}>{item.date}</span>
                <span style={{ flex: 1 }}>{item.event}</span>
                {timeline.showActor ? <span style={{ minWidth: 140, fontSize: 13, color: "var(--muted)" }}>{item.actor ?? "—"}</span> : null}
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
