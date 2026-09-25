import { PageHeader } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { NewTemplateForm } from "../new/NewTemplateForm";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { getTranslations } from "next-intl/server";

export const metadata = { title: "Edit JD Template — HR" };

/**
 * HIGH fix: jd-templates/page.tsx's "Edit" link has always pointed here
 * (`/hr/jd-templates/${tmpl.id}`) with no [id]/page.tsx ever existing behind
 * it — a dead 404. Reuses NewTemplateForm in edit mode (see its own header
 * comment) rather than a separate edit UI.
 *
 * Mirrors jd-templates/new/page.tsx: PATCH /v1/hrms/jd-templates/:id
 * requires the same HR_ROLES = ["hr_admin", "hr_officer", "super_admin"]
 * as the create route (jd-template-routes.ts).
 */
const JD_TEMPLATE_ADMIN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations("jdTemplateNew");
  const roles = getSessionRoles();
  const canEdit = roles.some((r: string) => JD_TEMPLATE_ADMIN_ROLES.includes(r));

  if (!canEdit) {
    return <PermissionDenied module="JD template editing" requiredRoles={JD_TEMPLATE_ADMIN_ROLES} />;
  }

  return (
    <div className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title={t("editTitle")}
        subtitle={t("editSubtitle")}
        back="/hr/jd-templates" backLabel="Back to JD Templates"
      />
      <NewTemplateForm templateId={id} />
    </div>
  );
}
