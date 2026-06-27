import { PageHeader } from "../../../../_components/ds";
import { NewPlanForm } from "./NewPlanForm";

export default function NewPlanPage() {
  return (
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="New Plan"
        subtitle="Create a new billing plan."
        back="/billing/plans"
      />
      <NewPlanForm />
    </main>
  );
}
