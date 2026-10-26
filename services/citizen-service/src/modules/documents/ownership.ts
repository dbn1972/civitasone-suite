import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { assertOwnership, isOfficer } from "../../shared/context.js";
import * as applicationRepo from "../application/repo.js";

/**
 * V4-G-04 — object-level ownership for an application a document request names.
 * Officers may act on any application in their tenant; a citizen may only touch
 * an application they own: a foreign application is a 404 so existence is not
 * leaked. An applicationId that resolves to NO application in the tenant is left
 * to the existing behaviour (the submission is recorded under the caller's own
 * citizenId and nothing of another citizen's is touched), preserving callers that
 * reference an application id before it is materialised. No-op when no
 * applicationId is supplied.
 */
export async function assertApplicationAccess(ctx: RequestContext, applicationId?: string | null): Promise<void> {
  if (!applicationId || isOfficer(ctx)) return;
  const app = await db.transaction((tx) => applicationRepo.findApplicationByIdTx(tx, applicationId, ctx.tenantId));
  if (!app) return;
  assertOwnership(ctx, app.citizenId);
}
