import { PageHeader } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { NewTrainingForm } from "./NewTrainingForm";
import { getSessionRoles } from "@/lib/auth/roleGuard";

/**
 * Mirrors training/routes.ts: POST /v1/hrms/trainings requires
 * HR_ROLES = ["hr_admin", "hr_officer", "super_admin"].
 */
const TRAINING_ADMIN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export default function NewTrainingPage() {
  const roles = getSessionRoles();
  const canCreate = roles.some((r: string) => TRAINING_ADMIN_ROLES.includes(r));

  if (!canCreate) {
    return <PermissionDenied module="training program creation" requiredRoles={TRAINING_ADMIN_ROLES} />;
  }

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="New Training Program"
        subtitle="Schedule a new capacity building initiative."
        back="/hr/training" backLabel="Back to Training"
      />
      <NewTrainingForm />
    </main>
  );
}
