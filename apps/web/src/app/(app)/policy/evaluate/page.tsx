import { PageHeader, Card } from "@/app/_components/ds";
import { getSessionRoles, hasAnyRole, POLICY_ADMIN_ROLES } from "@/lib/auth/roleGuard";
import { EvaluateForm } from "./EvaluateForm";

export const dynamic = "force-dynamic";

export default function PolicyEvaluatePage() {
  // GAP-POLICY-EVALUATE-01: only a policy admin may evaluate on behalf of
  // another user; the server re-checks this and audits it.
  const canEvaluateOthers = hasAnyRole(getSessionRoles(), POLICY_ADMIN_ROLES);

  return (
    <div className="page-main wrap" aria-label="Policy evaluate">
      <PageHeader
        title="Evaluate Permission"
        subtitle="Check whether a permission is allowed and which rule decided it."
        back="/policy"
      />
      <Card title="Decision request" padding>
        <EvaluateForm canEvaluateOthers={canEvaluateOthers} />
      </Card>
    </div>
  );
}
