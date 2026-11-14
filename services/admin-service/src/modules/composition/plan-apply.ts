/**
 * M6 — apply a sold plan to a tenant, maker-checker.
 *
 *   POST /v1/admin/composition/plan-applications               request (maker)      -> 202 {id}
 *   GET  /v1/admin/composition/plan-applications?tenantId=      list a tenant's requests
 *   POST /v1/admin/composition/plan-applications/:id/approve    approve (checker)    -> 202
 *   POST /v1/admin/composition/plan-applications/:id/reject     reject  (checker)    -> 202
 *
 * The request names a plan by id, NOT a module list. The module set is fetched server-side from tenant-service
 * (GET /v1/plans/:id/modules with the maker's own token; already resolved with the catalogue's hard dependencies), so
 * the maker cannot type a list that differs from the plan. This service still does not read tenant-service's tables.
 * It re-resolves the set against the registry, so an unknown module or an unresolvable graph is refused, and stores
 * the plan id, code and resolved set on the request for the checker to see. The checker must be a different principal
 * than the maker: refused here (409), re-checked by the consumer, and enforced by a DB CHECK.
 *
 * The write itself is the existing applier (repo.applyPlanTx): entitlements + profile + audit in one transaction.
 * Nothing here runs automatically; existing tenants only change when a checker approves a request.
 *
 * PLAN_APPLY_MAKER_CHECKER=on closes EVERY direct write of a tenant's entitlements with 409 PLAN_APPLY_REQUIRES_APPROVAL:
 * apply-plan, onboard, modules/:id/enable, modules/:id/disable and bundles/:code/enable (refuseDirectEntitlementWrite).
 * Entitlements then change only through this approval flow. Default off = today's behaviour exactly.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { buildRegistry, resolveComposition, CompositionError } from "./domain.js";
import { planApplyRequests } from "./schema.js";
import { callUpstream, tenantServiceBaseUrl } from "../gap/upstream-client.js";

const PLATFORM_ADMIN = ["super_admin", "platform_admin"];
const idRe = /^[a-z][a-z0-9_]*$/;

export function planApplyRequiresApproval(): boolean {
  return process.env.PLAN_APPLY_MAKER_CHECKER === "on";
}

/** Called by every route that writes entitlements directly: with the flag on they must go through plan-applications. */
export function refuseDirectEntitlementWrite(): void {
  if (planApplyRequiresApproval()) {
    throw new HttpError(409, "PLAN_APPLY_REQUIRES_APPROVAL", "entitlement changes need approval: POST /v1/admin/composition/plan-applications");
  }
}

const requestBody = z.object({
  tenantId: z.string().uuid(),
  planId: z.string().uuid(),
  profileCode: z.string().min(1).max(64).regex(idRe).nullable().default(null),
});
const idParam = z.object({ id: z.string().uuid() });
const tenantBody = z.object({ tenantId: z.string().uuid() });
const rejectBody = tenantBody.extend({ reason: z.string().trim().min(5).max(500) });
const listQuery = z.object({ tenantId: z.string().uuid(), status: z.enum(["pending", "applied", "rejected"]).optional() });

export async function planApplyRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/admin/composition/plan-applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM_ADMIN);
    const body = requestBody.parse(req.body);
    // The plan's modules come from the stored plan, never from the request body.
    const up = await callUpstream<{ planCode?: string; selected?: string[] }>(req, ctx, "GET", tenantServiceBaseUrl(), `/v1/plans/${body.planId}/modules`);
    if (up.status === 404) throw new HttpError(404, "PLAN_NOT_FOUND", "plan not found");
    if (up.status < 200 || up.status >= 300 || typeof up.body?.planCode !== "string" || !Array.isArray(up.body.selected)) {
      throw new HttpError(502, "PLAN_LOOKUP_FAILED", "could not read the plan's modules from tenant-service");
    }
    const planCode = up.body.planCode;
    // the modules the plan itself names; hard dependencies are added by the registry resolution below, as dependencies
    const moduleIds = up.body.selected;
    if (moduleIds.length === 0) throw new HttpError(422, "PLAN_HAS_NO_MODULES", "the plan resolves to no modules");
    const reg = buildRegistry(await repo.loadRegistry(body.tenantId));
    let resolved;
    try {
      resolved = resolveComposition(reg, moduleIds);
    } catch (err) {
      if (err instanceof CompositionError) throw new HttpError(404, "UNKNOWN_MODULE", err.message);
      throw err;
    }
    if (body.profileCode !== null && !(await repo.loadProfiles(body.tenantId)).some((p) => p.code === body.profileCode)) {
      throw new HttpError(404, "UNKNOWN_PROFILE", `unknown org profile: ${body.profileCode}`);
    }
    const userModuleIds = resolved.entries.filter((e) => e.source === "user").map((e) => e.id).sort();
    const pending = await listRequests(body.tenantId, "pending");
    if (pending.length > 0) throw new HttpError(409, "PLAN_APPLY_PENDING", "this tenant already has a plan application awaiting approval");
    const accepted = await commands.planApplyRequest(ctx, { tenantId: body.tenantId, planId: body.planId, planCode, moduleIds, profileCode: body.profileCode, userModuleIds });
    return sendAccepted(reply, acceptedResponseSchema, accepted);
  });

  app.get("/v1/admin/composition/plan-applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM_ADMIN);
    const q = listQuery.parse(req.query);
    return reply.send({ requests: await listRequests(q.tenantId, q.status) });
  });

  app.post("/v1/admin/composition/plan-applications/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM_ADMIN);
    const { id } = idParam.parse(req.params);
    const { tenantId } = tenantBody.parse(req.body);
    const row = (await listRequests(tenantId)).find((r) => r.id === id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "plan application not found");
    if (row.status !== "pending") throw new HttpError(409, "NOT_PENDING", `plan application is already ${row.status}`);
    if (row.requestedBy === ctx.actorId) throw new HttpError(409, "MAKER_CHECKER_VIOLATION", "the person who requested a plan application cannot approve it");
    return sendAccepted(reply, acceptedResponseSchema, await commands.planApplyDecide(ctx, { tenantId, requestId: id, decision: "approve" }));
  });

  app.post("/v1/admin/composition/plan-applications/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM_ADMIN);
    const { id } = idParam.parse(req.params);
    const { tenantId, reason } = rejectBody.parse(req.body);
    const row = (await listRequests(tenantId)).find((r) => r.id === id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "plan application not found");
    if (row.status !== "pending") throw new HttpError(409, "NOT_PENDING", `plan application is already ${row.status}`);
    if (row.requestedBy === ctx.actorId) throw new HttpError(409, "MAKER_CHECKER_VIOLATION", "the person who requested a plan application cannot decide it; withdraw by asking another admin to reject");
    return sendAccepted(reply, acceptedResponseSchema, await commands.planApplyDecide(ctx, { tenantId, requestId: id, decision: "reject", reason }));
  });
}

async function listRequests(tenantId: string, status?: "pending" | "applied" | "rejected") {
  const rows = await runWithTenant(tenantId, () =>
    scopedRead((tx) => tx.select().from(planApplyRequests).where(eq(planApplyRequests.tenantId, tenantId)).orderBy(desc(planApplyRequests.requestedAt))));
  return rows.filter((r) => !status || r.status === status);
}
