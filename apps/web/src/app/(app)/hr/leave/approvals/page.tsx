import { PageHeader } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { LeaveApprovalsPanel } from "./LeaveApprovalsPanel";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";

/**
 * GAP-HR-LEAVE-APPROVALS-05 (decision): this page had NO role gate at all —
 * an employee opening the URL directly saw whatever workflow-service
 * returned for their own (empty, or 403'd) task query rather than an
 * honest PermissionDenied. Mirrors leave/page.tsx's ADMIN_OR_MANAGER_ROLES
 * (HR_ROLES + manager) — the roles that already see the Approvals link.
 */
const LEAVE_APPROVAL_ROLES = ["hr_admin", "hr_officer", "super_admin", "manager"];

export default async function LeaveApprovalsPage() {
  const t = await getTranslations("leaveApprovals");
  const roles = getSessionRoles();
  const canApprove = roles.some((r: string) => LEAVE_APPROVAL_ROLES.includes(r));

  if (!canApprove) {
    return <PermissionDenied module="leave approvals" requiredRoles={LEAVE_APPROVAL_ROLES} />;
  }

  return (
    <div className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title={t("title")} subtitle={t("subtitle")} back="/hr/leave" backLabel="Back to Leave" />
      <LeaveApprovalsPanel />
    </div>
  );
}
