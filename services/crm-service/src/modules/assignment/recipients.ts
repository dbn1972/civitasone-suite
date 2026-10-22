/**
 * GAP-CRM-ESCALATION-RULES-01 -- an escalation rule must point at a recipient
 * that exists. A mistyped role or a stale/foreign user id used to save cleanly
 * and the escalation then notified nobody, which for a lead-SLA breach means an
 * unescalated breach. The role must be one of the tenant's active roles
 * (policy-service) and the user an ACTIVE user of the caller's tenant
 * (identity-service). Fails closed: if the owning service cannot be reached the
 * rule is NOT saved (503), never saved unverified.
 */
import { HttpError } from "../../shared/context.js";
import { isActiveTenantUser } from "../../shared/identity-client.js";
import { listDirectoryRoles } from "../../shared/user-directory.js";

export async function assertEscalationRecipientExists(
  tenantId: string,
  recipient: { recipientRole?: string | undefined; recipientId?: string | undefined },
): Promise<void> {
  if (recipient.recipientRole) {
    // `fresh`: a role created or retired a moment ago must be judged as it is now.
    const roles = await listDirectoryRoles(tenantId, { fresh: true });
    if (roles === undefined) {
      throw new HttpError(503, "DIRECTORY_UNAVAILABLE", "could not verify the recipient role; try again");
    }
    if (!roles.some((role) => role.key === recipient.recipientRole)) {
      throw new HttpError(422, "INVALID_RECIPIENT", "recipientRole must be an active role in this tenant");
    }
  }
  if (recipient.recipientId) {
    const active = await isActiveTenantUser(tenantId, recipient.recipientId);
    if (active === undefined) {
      throw new HttpError(503, "DIRECTORY_UNAVAILABLE", "could not verify the recipient user; try again");
    }
    if (!active) {
      throw new HttpError(422, "INVALID_RECIPIENT", "recipientId must be an active user in this tenant");
    }
  }
}
