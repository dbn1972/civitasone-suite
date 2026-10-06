import { PageHeader } from "../../../../_components/ds";
import { requireAnyRole, BILLING_PLAN_ADMIN_ROLES } from "@/lib/auth/roleGuard";
import { NewPlanForm } from "./NewPlanForm";

export default function NewPlanPage() {
  // GAP-BILLING-PLANS-05: server-side gate. The billing-service POST route
  // enforces requireSuperAdmin; this redirects a non-super-admin away before
  // they can fill the form (UI hiding on the list is convenience only).
  requireAnyRole(BILLING_PLAN_ADMIN_ROLES, "/billing/plans");
  return (
    <div className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="New Plan"
        subtitle="Create a new billing plan."
        back="/billing/plans"
      />
      <NewPlanForm />
    </div>
  );
}
