import { PageHeader, Card } from "../../../../_components/ds";
import { PermissionDenied } from "../../../../_components/PermissionDenied";
import { AllocateLeaveForm } from "./AllocateLeaveForm";
import { getTranslations } from "next-intl/server";
import { getSessionRoles } from "@/lib/auth/roleGuard";

/**
 * Mirrors services/hrms-service/src/modules/leave/routes.ts's HR_ROLES
 * guard on POST /v1/hrms/leave-allocations exactly. (leave/routes.ts's
 * ALL_ROLES, which additionally includes "manager" and "employee", gates
 * the read-only GET of this same resource and other self-service leave
 * actions -- not this admin allocation action.)
 */
const LEAVE_ALLOCATE_ADMIN_ROLES = ["hr_admin", "hr_officer", "super_admin"];

export default async function AllocateLeavePage() {
  const roles = getSessionRoles();
  const canAdminister = roles.some((r) => LEAVE_ALLOCATE_ADMIN_ROLES.includes(r));

  if (!canAdminister) {
    return <PermissionDenied module="allocating leave" requiredRoles={LEAVE_ALLOCATE_ADMIN_ROLES} />;
  }

  const t = await getTranslations("leaveAllocate");
  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/hr/leave"
        backLabel={t("backLabel")}
      />
      <Card title={t("newAllocationCard")}>
        <div style={{ padding: "4px 0 8px" }}>
          <AllocateLeaveForm />
        </div>
      </Card>
    </main>
  );
}
