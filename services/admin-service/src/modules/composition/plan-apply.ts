/**
 * M6 — apply a sold plan to a tenant, maker-checker.
 *
 *   POST /v1/admin/composition/plan-applications               request (maker)      -> 202 {id}
 *   GET  /v1/admin/composition/plan-applications?tenantId=      list a tenant's requests
 *   POST /v1/admin/composition/plan-applications/:id/approve    approve (checker)    -> 202
 *   POST /v1/admin/composition/plan-applications/:id/reject     reject  (checker)    -> 202
 *
 * The module set comes from the plan (tenant-service GET /v1/plans/:id/modules, already resolved with the catalogue's
 * hard dependencies); this service does not read tenant-service's tables. It re-resolves the set against the
 * registry, so an unknown module or an unresolvable graph is refused. The checker must be a different principal
 * than the maker: refused here (409), re-checked by the consumer, and enforced by a DB CHECK.
 *
 * The write itself is the existing applier (repo.applyPlanTx): entitlements + profile + audit in one transaction.
 * Nothing here runs automatically; existing tenants only change when a checker approves a request.
 *
 * PLAN_APPLY_MAKER_CHECKER=on makes the older direct POST /v1/admin/composition/apply-plan refuse (409), so a plan can
 * only be applied through this approval flow. Default off = today's behaviour exactly.
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

const PLATFORM_ADMIN = ["super_admin", "platform_admin"];
const idRe = /^[a-z][a-z0-9_]*$/;

export function planApplyRequiresApproval(): boolean {
  return process.env.PLAN_APPLY_MAKER_CHECKER === "on";
}

const requestBody = z.object({
  tenantId: z.string().uuid(),
  planCode: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/),
  moduleIds: z.array(z.string().min(1).max(64).regex(idRe)).min(1).max(128),
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
    const reg = buildRegistry(await repo.loadRegistry(body.tenantId));
    let resolved;
    try {
      resolved = resolveComposition(reg, body.moduleIds);
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
    const accepted = await commands.planApplyRequest(ctx, { ...body, userModuleIds });
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
