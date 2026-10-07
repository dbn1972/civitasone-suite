import Link from "next/link";
import { PageHeader, Card, DataTable } from "../../../../_components/ds";
import { ESCALATION_BANDS, bandLabel } from "./escalationBands";

type EscalationRow = {
  estimatedValue: string;
  approvingAuthority: string;
  escalatesAfter: string;
};

/**
 * Escalation rules reference. The approval routing itself is configured in the
 * workflow service (GAP-PROCUREMENT-APPROVALS-ESCALATION-01: that service is
 * not in this worktree, so these thresholds are a developer-maintained
 * reference, not a backend load — confirm against the real delegation of
 * financial powers before relying on them). The bands are now modelled as
 * numeric half-open paise ranges (escalationBands.ts) and labelled with
 * formatMoney so no boundary amount appears in two bands
 * (GAP-PROCUREMENT-APPROVALS-ESCALATION-02).
 */
export default function EscalationRulesPage() {
  const rows: EscalationRow[] = ESCALATION_BANDS.map((band, i) => ({
    estimatedValue: bandLabel(band, i),
    approvingAuthority: band.approvingAuthority,
    escalatesAfter: `${band.escalatesAfterDays} working days`,
  }));

  const columns: { key: keyof EscalationRow; label: string }[] = [
    { key: "estimatedValue", label: "Estimated value" },
    { key: "approvingAuthority", label: "Approving authority" },
    { key: "escalatesAfter", label: "Escalates after" },
  ];

  return (
    <>
      <PageHeader
        title="Approval Escalation Rules"
        subtitle="How procurement approvals are routed and escalated."
        back="/procurement/approvals"
        backLabel="Back to Approvals"
        actions={
          // GAP-PROCUREMENT-APPROVALS-ESCALATION-03: a direct link to the
          // queue these rules govern, not just the back link.
          <Link href="/procurement/approvals" className="btn ghost">View pending approvals</Link>
        }
      />

      <Card title="Routing thresholds">
        <DataTable<EscalationRow>
          columns={columns}
          rows={rows}
          pageSize={25}
        />
        {/* GAP-PROCUREMENT-APPROVALS-ESCALATION-03: name the working-day
            calendar and the SLA owner so "working days" is unambiguous. */}
        <p className="text-xs text-slate-600 px-4 pb-3 pt-1" role="note">
          “Working days” exclude weekends and the tenant’s configured public-holiday
          calendar (Settings → Holiday Calendar). The procurement officer-in-charge
          owns the escalation SLA; unactioned items route to the next authority
          automatically.
        </p>
      </Card>

      <Card title="Separation of duties (SoD)" padding>
        {/* GAP-PROCUREMENT-APPROVALS-ESCALATION-04: DS/Tailwind utility classes
            instead of an inline style attribute. */}
        <ul className="m-0 ps-5 text-sm leading-relaxed space-y-1 list-disc">
          <li>The officer who raises an indent or PO cannot approve their own request (maker-checker).</li>
          <li>Every rejection requires a recorded reason, retained in the audit trail.</li>
          <li>Items not actioned within the threshold above are escalated to the next authority automatically.</li>
        </ul>
      </Card>
    </>
  );
}
