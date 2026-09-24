import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { PageHeader, Card } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { NewJobOpeningForm } from "./NewJobOpeningForm";
import { getSessionRoles } from "@/lib/auth/roleGuard";

/**
 * Mirrors services/hrms-service/src/modules/recruitment/routes.ts's
 * HR_ROLES guard on POST /v1/hrms/job-openings exactly. (That file's
 * ALL_ROLES, which additionally includes "manager", gates the read-only
 * GET /v1/hrms/job-openings list -- not creating one.)
 */
const RECRUITMENT_ADMIN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export default async function NewJobOpeningPage() {
  const roles = getSessionRoles();
  const canAdminister = roles.some((r) => RECRUITMENT_ADMIN_ROLES.includes(r));

  if (!canAdminister) {
    return <PermissionDenied module="creating a job opening" requiredRoles={RECRUITMENT_ADMIN_ROLES} />;
  }

  const t = await getTranslations("recruitmentNewJob");
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("pageTitle")}
        subtitle={t("pageSubtitle")}
        back="/hr/recruitment" backLabel="Back to Recruitment"
      />
      <Card>
        <Suspense fallback={<div className="text-sm text-slate-500">{t("loadingForm")}</div>}>
          <NewJobOpeningForm />
        </Suspense>
      </Card>
    </div>
  );
}
