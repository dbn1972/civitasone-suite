import { PageHeader, Card, DataTable } from "../../../../_components/ds";

type EscalationRow = {
  estimatedValue: string;
  approvingAuthority: string;
  escalatesAfter: string;
};

const ESCALATION_ROWS: EscalationRow[] = [
  { estimatedValue: "Up to ₹1,00,000", approvingAuthority: "Procurement Officer", escalatesAfter: "2 working days" },
  { estimatedValue: "₹1,00,000 – ₹10,00,000", approvingAuthority: "Procurement Admin", escalatesAfter: "3 working days" },
  { estimatedValue: "Above ₹10,00,000", approvingAuthority: "Procurement Admin + Finance", escalatesAfter: "5 working days" },
];

const ESCALATION_COLUMNS: { key: keyof EscalationRow; label: string }[] = [
  { key: "estimatedValue", label: "Estimated value" },
  { key: "approvingAuthority", label: "Approving authority" },
  { key: "escalatesAfter", label: "Escalates after" },
];

/**
 * Escalation rules reference. The approval routing itself is configured in the
 * workflow service; this page documents the policy that governs procurement
 * sign-offs (GFR 2017 delegation of financial powers + separation of duties).
 */
export default function EscalationRulesPage() {
  return (
    <>
      <PageHeader
        title="Approval Escalation Rules"
        subtitle="How procurement approvals are routed and escalated."
        back="/procurement/approvals"
        backLabel="Back to Approvals"
      />

      <Card title="Routing thresholds">
        <DataTable<EscalationRow>
          columns={ESCALATION_COLUMNS}
          rows={ESCALATION_ROWS}
          pageSize={25}
        />
      </Card>

      <Card title="Separation of duties (SoD)" padding>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, lineHeight: 1.7 }}>
          <li>The officer who raises an indent or PO cannot approve their own request (maker-checker).</li>
          <li>Every rejection requires a recorded reason, retained in the audit trail.</li>
          <li>Items not actioned within the threshold above are escalated to the next authority automatically.</li>
        </ul>
      </Card>
    </>
  );
}
