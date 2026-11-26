import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../../_components/ds";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { HR_STAFF_ROLES } from "@/lib/auth/workRoles";
import { NewDeputationForm } from "./NewDeputationForm";

/**
 * GAP-HR-DEPUTATION-02 (owner decision, 26 Nov 2026): "New deputation" lives at /hr/deputation/new,
 * gated to HR_ROLES -- hrms-service deputation/routes.ts's own HR_ROLES on
 * POST /v1/hrms/employees/:id/deputations (hr_admin, hr_officer, super_admin). Creating one switches the
 * employee's posting and reporting line immediately, hence the confirm dialog in the form.
 */
const DEPUTATION_CREATE_ROLES = HR_STAFF_ROLES;

export default async function NewDeputationPage() {
  const t = await getTranslations("deputationNew");
  const roles = getSessionRoles();
  if (!roles.some((r) => DEPUTATION_CREATE_ROLES.includes(r))) {
    return <PermissionDenied module="new deputation" requiredRoles={DEPUTATION_CREATE_ROLES} />;
  }
  return (
    <div className="page-main wrap">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/deputation" backLabel={t("backLabel")} />
      <NewDeputationForm />
    </div>
  );
}
