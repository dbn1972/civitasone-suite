import { PageHeader, Card } from "../../../../_components/ds";

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

      <Card title="Routing thresholds" padding>
        <table className="tbl">
          <thead>
            <tr>
              <th scope="col">Estimated value</th>
              <th scope="col">Approving authority</th>
              <th scope="col">Escalates after</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Up to ₹1,00,000</td><td>Procurement Officer</td><td>2 working days</td></tr>
            <tr><td>₹1,00,000 – ₹10,00,000</td><td>Procurement Admin</td><td>3 working days</td></tr>
            <tr><td>Above ₹10,00,000</td><td>Procurement Admin + Finance</td><td>5 working days</td></tr>
          </tbody>
        </table>
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
