import { PageHeader, Card } from "@/app/_components/ds";
import { EvaluateForm } from "./EvaluateForm";

export const dynamic = "force-dynamic";

export default function PolicyEvaluatePage() {
  return (
    <main className="page-main wrap" aria-label="Policy evaluate">
      <PageHeader
        title="Evaluate Permission"
        subtitle="Run a decision against /api/v1/policy/evaluate (RBAC + ABAC)."
        back="/policy"
      />
      <Card title="Decision request" padding>
        <EvaluateForm />
      </Card>
    </main>
  );
}
