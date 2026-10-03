/**
 * GAP-ADMIN-TENANTS-DETAIL-05 -- tenant lifecycle approval routes.
 *
 * Routes never write the database: they validate, pre-check against a fresh
 * read (so the operator gets a synchronous 4xx instead of a silent async
 * failure) and publish a command. The consumer re-applies every rule inside
 * its transaction; the pre-check is courtesy, the consumer is the authority.
 */
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireSuperAdmin, HttpError } from "../../shared/context.js";
import { idParam } from "./validators.js";
import * as repo from "./repo.js";
import * as lrepo from "./lifecycle-repo.js";
import * as commands from "./lifecycle-commands.js";
import {
  approvalPolicySchema, assertCanCancel, assertCanDecide, assertNotOwnTenant, assertReason, editPayloadSchema, holdsAnyRole,
  KIND_TARGET_STATUS, LIFECYCLE_STATUSES, LifecycleError, requirementsFor, resolvePolicy,
  type LifecycleKind,
} from "./lifecycle-domain.js";
import { assertTransition } from "./domain.js";
import type { LifecycleRequestRow } from "./schema.js";

const requestIdParam = z.object({ id: z.string().uuid(), requestId: z.string().uuid() });

const reasonField = z.string().trim().min(3).max(500).optional();

const createBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("suspend"), reason: reasonField,
    effectiveAt: z.string().datetime().optional(),
  }),
  z.object({ kind: z.literal("reactivate"), reason: reasonField }),
  z.object({ kind: z.literal("edit"), reason: reasonField, changes: editPayloadSchema }),
]);
export type CreateLifecycleBody = z.infer<typeof createBody>;

const decisionBody = z.object({
  decision: z.enum(["approve", "reject"]),
  comment: z.string().trim().max(1000).optional(),
});

const policyBody = z.object({
  policy: approvalPolicySchema,
  reason: reasonField,
});

const listQuery = z.object({
  status: z.enum(LIFECYCLE_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

function lifecycleToHttp(err: LifecycleError): HttpError {
  return new HttpError(err.status, err.code, err.message);
}

async function loadTenant(id: string) {
  const t = await repo.findById(id);
  if (!t) throw new HttpError(404, "NOT_FOUND", "tenant not found");
  return t;
}

function view(r: LifecycleRequestRow, callerId: string, canDecide: boolean, canCancel = false) {
  return {
    id: r.id, tenantId: r.tenantId, kind: r.kind, status: r.status, reason: r.reason,
    payload: r.payload, effectiveAt: r.effectiveAt?.toISOString() ?? null,
    requestedAt: r.requestedAt.toISOString(), requestedByYou: r.requestedBy === callerId,
    requiredApprovals: r.requiredApprovals, approvalsCount: r.approvalsCount, approverRoles: r.approverRoles,
    decidedAt: r.decidedAt?.toISOString() ?? null, decidedByYou: r.decidedBy === callerId,
    decisionReason: r.decisionReason, failureCode: r.failureCode, directExecution: r.directExecution,
    executedAt: r.executedAt?.toISOString() ?? null, canDecide, canCancel,
    cancelledByYou: r.cancelledBy === callerId, cancelReason: r.cancelReason,
  };
}

export async function tenantLifecycleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/admin/tenants/:id/approval-policy", async (req, reply) => {
    const ctx = resolveContext(req); requireSuperAdmin(ctx);
    const { id } = idParam.parse(req.params);
    const t = await loadTenant(id);
    const open = await lrepo.findOpen(id, "policy_change");
    return reply.send({
      policy: resolvePolicy(t.settings),
      isDefault: !("approvalPolicy" in t.settings),
      pendingChange: open ? view(open, ctx.actorId, false) : null,
    });
  });

  app.put("/v1/admin/tenants/:id/approval-policy", async (req, reply) => {
    const ctx = resolveContext(req); requireSuperAdmin(ctx);
    const { id } = idParam.parse(req.params);
    const body = policyBody.parse(req.body);
    try {
      assertNotOwnTenant(ctx, id);
      await loadTenant(id);
      assertReason(body.reason, true);
    } catch (e) { throw e instanceof LifecycleError ? lifecycleToHttp(e) : e; }
    if (await lrepo.findOpen(id, "policy_change")) {
      throw new HttpError(409, "REQUEST_ALREADY_OPEN", "a policy change is already awaiting approval");
    }
    // Always a request: changing the policy needs a second platform approver.
    return sendAccepted(reply, acceptedResponseSchema, await commands.requestLifecycleChange(ctx, id, {
      kind: "policy_change", reason: (body.reason ?? "").trim(), effectiveAt: null, policy: body.policy,
    }));
  });

  app.get("/v1/admin/tenants/:id/lifecycle-requests", async (req, reply) => {
    const ctx = resolveContext(req); requireSuperAdmin(ctx);
    const { id } = idParam.parse(req.params);
    const q = listQuery.parse(req.query);
    await loadTenant(id);
    const rows = await lrepo.listRequests(id, q.status, q.limit);
    const approvers = await lrepo.listApproverIds(id, rows.filter((r) => r.status === "scheduled").map((r) => r.id));
    const items = rows.map((r) => {
      let can = false;
      try { assertCanDecide({ actor: ctx, request: r }); can = true; } catch { can = false; }
      let cancel = false;
      try { assertCanCancel({ actor: ctx, request: r, approverIds: approvers.get(r.id) ?? [] }); cancel = true; } catch { cancel = false; }
      return view(r, ctx.actorId, can, cancel);
    });
    return reply.send({ items, total: items.length });
  });

  app.post("/v1/admin/tenants/:id/lifecycle-requests", async (req, reply) => {
    const ctx = resolveContext(req); requireSuperAdmin(ctx);
    const { id } = idParam.parse(req.params);
    const body = createBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await create(ctx, id, body));
  });

  app.post("/v1/admin/tenants/:id/lifecycle-requests/:requestId/decision", async (req, reply) => {
    const ctx = resolveContext(req); requireSuperAdmin(ctx);
    const { id, requestId } = requestIdParam.parse(req.params);
    const body = decisionBody.parse(req.body);
    const r = await lrepo.findRequest(id, requestId);
    if (!r) throw new HttpError(404, "NOT_FOUND", "request not found");
    try { assertCanDecide({ actor: ctx, request: r }); } catch (e) { throw e instanceof LifecycleError ? lifecycleToHttp(e) : e; }
    return sendAccepted(reply, acceptedResponseSchema,
      await commands.decideLifecycleRequest(ctx, id, requestId, body.decision, body.comment ?? null));
  });

  app.post("/v1/admin/tenants/:id/lifecycle-requests/:requestId/cancel", async (req, reply) => {
    const ctx = resolveContext(req); requireSuperAdmin(ctx);
    const { id, requestId } = requestIdParam.parse(req.params);
    const body = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
    const r = await lrepo.findRequest(id, requestId);
    if (!r) throw new HttpError(404, "NOT_FOUND", "request not found");
    const approvers = await lrepo.listApproverIds(id, [r.id]);
    try { assertCanCancel({ actor: ctx, request: r, approverIds: approvers.get(r.id) ?? [] }); }
    catch (e) { throw e instanceof LifecycleError ? lifecycleToHttp(e) : e; }
    return sendAccepted(reply, acceptedResponseSchema, await commands.cancelLifecycleRequest(ctx, id, requestId, body.reason));
  });

  // Legacy direct routes: kept for callers of the old API, but they no longer
  // bypass the policy -- each is now just another lifecycle request.
  app.patch("/v1/admin/tenants/:id/suspend", async (req, reply) => {
    const ctx = resolveContext(req); requireSuperAdmin(ctx);
    const { id } = idParam.parse(req.params);
    const body = z.object({ reason: z.string().trim().min(3).max(500), effectiveAt: z.string().datetime().optional() }).parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await create(ctx, id, { kind: "suspend", ...body }, false));
  });

  app.patch("/v1/admin/tenants/:id/reactivate", async (req, reply) => {
    const ctx = resolveContext(req); requireSuperAdmin(ctx);
    const { id } = idParam.parse(req.params);
    const body = z.object({ reason: reasonField }).parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await create(ctx, id, { kind: "reactivate", ...body }, false));
  });

  app.patch("/v1/admin/tenants/:id/edition", async (req, reply) => {
    const ctx = resolveContext(req); requireSuperAdmin(ctx);
    const { id } = idParam.parse(req.params);
    const body = z.object({ edition: z.enum(["govt_dept", "psu", "small_office"]), reason: reasonField }).parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema,
      await create(ctx, id, { kind: "edit", reason: body.reason, changes: { edition: body.edition } }, false));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}

/**
 * `strict` = the caller wants a synchronous 404/409 pre-check against the
 * tenant row. The three legacy PATCH routes pass false: they historically
 * answered 202 without looking the tenant up, and the consumer (the real
 * authority) records an unknown tenant or a policy refusal on its own.
 */
async function create(ctx: ReturnType<typeof resolveContext>, id: string, body: CreateLifecycleBody, strict = true) {
  const kind: LifecycleKind = body.kind;
  try { assertNotOwnTenant(ctx, id); } catch (e) { throw e instanceof LifecycleError ? lifecycleToHttp(e) : e; }
  const t = strict ? await loadTenant(id) : await repo.findById(id);
  if (!t) return publish(ctx, id, body);
  try {
    const need = requirementsFor(kind, resolvePolicy(t.settings));
    assertReason(body.reason, need.reasonRequired);
    if (need.direct && !holdsAnyRole(ctx.roles, need.approverRoles)) {
      throw new LifecycleError("NOT_AN_APPROVER", "your role may not act directly under this tenant's policy", 403);
    }
    const target = KIND_TARGET_STATUS[kind];
    if (target) assertTransition(t.status, target);
    if (kind === "reactivate" && t.status !== "suspended") {
      throw new LifecycleError("INVALID_TRANSITION", "only a suspended tenant can be reactivated", 409);
    }
  } catch (e) {
    if (e instanceof LifecycleError) throw lifecycleToHttp(e);
    // assertTransition throws DomainError
    if (e instanceof Error && e.name === "DomainError") throw new HttpError(409, "INVALID_TRANSITION", e.message);
    throw e;
  }
  if (await lrepo.findOpen(id, kind)) {
    throw new HttpError(409, "REQUEST_ALREADY_OPEN", `a ${kind} request is already open for this tenant`);
  }
  return publish(ctx, id, body);
}

function publish(ctx: ReturnType<typeof resolveContext>, id: string, body: CreateLifecycleBody) {
  const kind: LifecycleKind = body.kind;
  return commands.requestLifecycleChange(ctx, id, {
    kind, reason: (body.reason ?? "").trim(),
    effectiveAt: body.kind === "suspend" ? (body.effectiveAt ?? null) : null,
    ...(body.kind === "edit" ? { edit: body.changes } : {}),
  });
}
