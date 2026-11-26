import type { EntityOption } from "@/app/_components/ds";
import type { StrictOpt } from "./strict";
import { searchDirectoryUsers, resolveDirectoryUsers } from "@/lib/directory/searchUsers";

/**
 * EntityPicker adapters for identity-service users (GAP-HR-PROMOTION-05 "initiating
 * officer" / "forward to", helpdesk ticket assignment, contract obligation owner,
 * works authority pickers).
 *
 * These pickers are used by non-admin officers, so they go through identity-services
 * open, tenant-scoped, non-PII directory (`GET /v1/identity/users/directory`, any
 * authenticated member of the caller own tenant) -- NOT the ADMIN-gated
 * `/identity/users` list (403 for non-admins) and not the unregistered
 * `/v1/identity/users` path. The directory returns only { id, displayName }:
 * there is no designation, so options carry a label and no sublabel.
 *
 *   - search: name type-ahead, min 2 chars, capped at 20 rows (server contract).
 *   - resolve: batch label lookup by id (UUIDs only, 200 per request).
 */
export async function searchIdentityUsers(query: string, signal: AbortSignal, opts?: StrictOpt): Promise<EntityOption[]> {
  return searchDirectoryUsers(query, signal, opts);
}

export async function resolveIdentityUsers(ids: string[]): Promise<EntityOption[]> {
  return resolveDirectoryUsers(ids);
}
