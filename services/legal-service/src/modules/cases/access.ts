/**
 * GAP-LEGAL-CASES-DETAIL-06 (owner decision #12): privileged / confidential case access.
 *
 * A privileged case is visible only to the officers it is assigned to and to the legal head
 * (role `legal_admin`, the Keycloak realm role for the head of legal). Anyone else gets a plain
 * 404 -- the case's existence is not revealed -- on the case, its sub-resources, and the lists
 * and aggregates that would otherwise expose it. Non-privileged cases are unaffected, and legal
 * roles are never masked from party names (no masking rule exists or is added).
 */
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import { HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";

export const LEGAL_HEAD_ROLES = ["legal_admin"];

type Viewer = Pick<RequestContext, "actorId" | "roles">;
type AccessRow = { privileged: boolean | null; assignedOfficerIds: string[] | null };

export function mayAccessCase(viewer: Viewer, c: AccessRow): boolean {
  if (!c.privileged) return true;
  if (hasAnyRole(viewer as RequestContext, LEGAL_HEAD_ROLES)) return true;
  return (c.assignedOfficerIds ?? []).includes(viewer.actorId);
}

/** Ids of the privileged cases this viewer may NOT see (empty for the legal head). */
export async function hiddenCaseIds(ctx: RequestContext): Promise<string[]> {
  if (hasAnyRole(ctx, LEGAL_HEAD_ROLES)) return [];
  const rows = await repo.listPrivilegedCases(ctx.tenantId);
  return rows.filter((r) => !mayAccessCase(ctx, r)).map((r) => r.id);
}

/** 404 when the case exists, is privileged and the viewer may not see it. A missing case passes through unchanged. */
export async function assertCaseAccess(ctx: RequestContext, caseId: string): Promise<void> {
  const row = await repo.findCaseById(caseId, ctx.tenantId);
  if (row && !mayAccessCase(ctx, row)) throw new HttpError(404, "NOT_FOUND", "case not found");
}
