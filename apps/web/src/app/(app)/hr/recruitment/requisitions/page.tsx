import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { RequisitionsClient } from "./RequisitionsClient";

/** Mirrors CREATE_ROLES in services/hrms-service/src/modules/recruitment/requisition-routes.ts (list + create). */
const REQUISITION_ROLES = ["hr_admin", "hr_officer", "super_admin", "hiring_manager", "manager"];

export default async function RequisitionsPage() {
  const roles = getSessionRoles();
  if (!roles.some((r) => REQUISITION_ROLES.includes(r))) {
    return <PermissionDenied module="job requisitions" requiredRoles={REQUISITION_ROLES} />;
  }
  const t = await getTranslations("recruitmentRequisitions");
  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("pageTitle")} subtitle={t("pageSubtitle")} back="/hr/recruitment" backLabel="Back to Recruitment" />
      <RequisitionsClient />
    </div>
  );
}
