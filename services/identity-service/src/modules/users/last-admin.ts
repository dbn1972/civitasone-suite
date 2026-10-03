import { wouldStrandTenantAdmins, TENANT_ADMIN_ROLE_KEY } from "./domain.js";
import * as userRepo from "./repo.js";
import * as rbacRepo from "../rbac/repo.js";

/**
 * GAP-ADMIN-USERS-01: true when taking `userId` out of service (suspend/lock/deactivate, or
 * revoking their tenant_admin role) would leave the tenant with no ACTIVE tenant admin.
 * A user who is not currently an active tenant admin cannot strand anyone.
 */
export async function strandsTenantAdmins(tx: rbacRepo.Writer, tenantId: string, userId: string): Promise<boolean> {
  const holders = await rbacRepo.activeRoleHolderIds(tx, tenantId, TENANT_ADMIN_ROLE_KEY);
  if (!holders.includes(userId)) return false;
  const active = await userRepo.activeAmong(tx, tenantId, holders);
  if (!active.includes(userId)) return false;
  return wouldStrandTenantAdmins(holders, active, userId);
}
