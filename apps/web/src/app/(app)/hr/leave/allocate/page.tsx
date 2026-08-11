import { PageHeader, Card } from "../../../../_components/ds";
import { AllocateLeaveForm } from "./AllocateLeaveForm";

export default function AllocateLeavePage() {
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Allocate Leave"
        subtitle="Grant leave entitlement to an employee for the financial year."
        back="/hr/leave"
        backLabel="Leave"
      />
      <Card title="New Allocation">
        <div style={{ padding: "4px 0 8px" }}>
          <AllocateLeaveForm />
        </div>
      </Card>
    </main>
  );
}
