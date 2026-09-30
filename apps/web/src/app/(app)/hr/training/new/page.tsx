import { PageHeader } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { NewTrainingForm } from "./NewTrainingForm";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { getTranslations } from "next-intl/server";

/**
 * Mirrors training/routes.ts: POST /v1/hrms/trainings requires
 * HR_ROLES = ["hr_admin", "hr_officer", "super_admin"].
 */
const TRAINING_ADMIN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export default async function NewTrainingPage() {
  const t = await getTranslations("trainingNew");
  const roles = getSessionRoles();
  const canCreate = roles.some((r: string) => TRAINING_ADMIN_ROLES.includes(r));

  if (!canCreate) {
    return <PermissionDenied module="training program creation" requiredRoles={TRAINING_ADMIN_ROLES} />;
  }

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/training" backLabel={t("backLabel")}
      />
      <NewTrainingForm />
    </div>
  );
}
