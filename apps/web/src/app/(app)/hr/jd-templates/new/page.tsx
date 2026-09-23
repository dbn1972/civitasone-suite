import { PageHeader } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { NewTemplateForm } from "./NewTemplateForm";
import { getSessionRoles } from "@/lib/auth/roleGuard";

export const metadata = { title: "New JD Template — HR" };

/**
 * Mirrors jd-template-routes.ts: POST /v1/hrms/jd-templates requires
 * HR_ROLES = ["hr_admin", "hr_officer", "super_admin"].
 */
const JD_TEMPLATE_ADMIN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export default function NewTemplatePage() {
  const roles = getSessionRoles();
  const canCreate = roles.some((r: string) => JD_TEMPLATE_ADMIN_ROLES.includes(r));

  if (!canCreate) {
    return <PermissionDenied module="JD template creation" requiredRoles={JD_TEMPLATE_ADMIN_ROLES} />;
  }

  return (
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="New JD Template"
        subtitle="Create a reusable job description template."
        back="/hr/jd-templates"
      />
      <NewTemplateForm />
    </main>
  );
}
