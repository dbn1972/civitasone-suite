import { PageHeader, Card } from "../../../../../_components/ds";
import { OvertimeClaimForm } from "../../../_components/OvertimeClaimForm";

/**
 * OvertimeNewPage — submit a new overtime claim via OvertimeClaimForm.
 * CCS (Leave) Rules: OT compensation as cash or comp-off.
 */
export default function OvertimeNewPage() {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="New Overtime Claim"
        subtitle="Submit an overtime claim for duty officer approval. CCS Rules apply."
        back="/hr/workforce/overtime"
      />
      <div style={{ maxWidth: 540, marginTop: 20 }}>
        <Card title="Claim Details">
          <OvertimeClaimForm />
        </Card>
      </div>
    </main>
  );
}
