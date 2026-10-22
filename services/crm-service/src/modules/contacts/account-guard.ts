import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";

/**
 * GAP-CRM F5: synchronous account-link guard for the contact and activity write routes.
 *
 * A contact or activity may only be linked to a LIVE account of the caller tenant. Before this
 * guard the route answered 202 and the consumer silently refused the write afterwards (audit-only),
 * so the caller never learned the record was not saved. Now the request fails up front with 422:
 *  - ACCOUNT_INACTIVE: the account exists in this tenant but was merged away or deactivated;
 *  - ACCOUNT_NOT_FOUND: no such account in this tenant (same code the deals routes use).
 * The consumers keep their own in-transaction check, so a command queued while the account was
 * still live cannot bypass this either.
 */
export async function assertAccountLinkable(tenantId: string, accountId: string | null | undefined): Promise<void> {
  if (!accountId) return; // no link (or an explicit null unlink): nothing to guard
  const state = await repo.accountLinkState(tenantId, accountId);
  if (state === "active") return;
  if (state === "inactive") {
    throw new HttpError(422, "ACCOUNT_INACTIVE", "the selected account has been merged or deactivated and cannot be linked");
  }
  throw new HttpError(422, "ACCOUNT_NOT_FOUND", "the selected account does not exist in this tenant");
}
