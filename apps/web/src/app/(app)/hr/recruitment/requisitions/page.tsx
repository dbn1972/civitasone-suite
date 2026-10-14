import { getTranslations } from "next-intl/server";
import { PageHeader } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { RequisitionsClient } from "./RequisitionsClient";
import { RECRUITMENT_REQUISITION_ROLES } from "@/lib/auth/workRoles";

/** Mirrors CREATE_ROLES in services/hrms-service/src/modules/recruitment/requisition-routes.ts (list + create). */
const REQUISITION_ROLES = RECRUITMENT_REQUISITION_ROLES;

export default async function RequisitionsPage() {
  const roles = getSessionRoles();
  if (!roles.some((r) => REQUISITION_ROLES.includes(r))) {
    return <PermissionDenied module="job requisitions" requiredRoles={REQUISITION_ROLES} />;
  }
  const t = await getTranslations("recruitmentRequisitions");
  return (
    <div className="page-main wrap">
      <PageHeader title={t("pageTitle")} subtitle={t("pageSubtitle")} back="/hr/recruitment" backLabel="Back to Recruitment" />
      <RequisitionsClient />
    </div>
  );
}
