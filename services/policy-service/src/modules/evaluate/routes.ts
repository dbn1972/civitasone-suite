import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, HttpError } from "../../shared/context.js";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import * as repo from "./repo.js";
import { loadCompiledRules } from "../abac/repo.js";
import { evaluateWithAbac } from "./domain.js";
import type { AttrBag } from "../abac/domain.js";

const AUDIT = "policy.decision";

// GAP-POLICY-EVALUATE-01: roles permitted to evaluate a permission *for another
// user* (admin "why was X denied?"). Mirrors the ADMIN set gating bindings/abac
// in this service. A caller outside this set may only evaluate themselves.
const EVAL_SUBJECT_ADMIN = ["platform_admin", "super_admin", "tenant_admin"];

const evaluateBody = z.object({
  permissionKey: z.string().min(3),
  actor: z.object({
    userId: z.string().uuid(),
    tenantId: z.string().uuid(),
    roles: z.array(z.string()).default([]),
  }).optional(),
  resource: z.record(z.unknown()).optional(),
  /** Trusted internal callers may pass the subject's org attributes explicitly
   * (office/jurisdiction) when evaluating on behalf of another principal. */
  subjectAttrs: z.record(z.unknown()).optional(),
  /** GAP-POLICY-EVALUATE-01: an admin may evaluate on behalf of another user in
   * their OWN tenant. The subject's effective roles are resolved from the
   * binding store by this userId; the decision is audited with the subject. */
  subjectUserId: z.string().uuid().optional(),
});

export async function evaluateRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/policy/evaluate", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = evaluateBody.parse(req.body);

    // SAST-002 (CWE-863): NEVER trust a client-supplied actor. The evaluated
    // principal is derived from the authenticated context (ctx) by default.
    // A client-supplied body.actor (tenantId/roles) is honoured ONLY when the
    // caller proves it is a trusted internal service via the internal-trust
    // headers. The gateway strips `x-internal` / `x-service-secret` from
    // external clients, so end-user requests can never reach the internal path.
    const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
    const isInternalCaller =
      req.headers["x-internal"] === "1" &&
      typeof internalSecret === "string" &&
      internalSecret.length > 0 &&
      req.headers["x-service-secret"] === internalSecret;

    const actor =
      isInternalCaller && body.actor
        ? body.actor
        : {
            userId: ctx.actorId,
            tenantId: ctx.tenantId,
            roles: ctx.roles,
          };

    // GAP-POLICY-EVALUATE-01: an end-user admin may evaluate on behalf of
    // another user *in their own tenant*. This is gated on the admin role set
    // and audited (subjectUserId recorded below). The subject's effective roles
    // are resolved from the binding store by userId (jwtRoleNames=[]), so this
    // never trusts client-asserted roles. Org/ABAC subject attributes are NOT
    // available for a third party here (they live in that user's own JWT), so
    // jurisdiction-fencing ABAC predicates are not applied to a subject-override
    // evaluation — the RBAC decision and role-scoped ABAC rules still apply.
    const isSubjectOverride =
      !isInternalCaller &&
      body.subjectUserId !== undefined &&
      body.subjectUserId !== actor.userId;
    if (isSubjectOverride) {
      const allowed = EVAL_SUBJECT_ADMIN.some((r) => ctx.roles.includes(r));
      if (!allowed) {
        throw new HttpError(403, "FORBIDDEN", "Evaluating another user requires a policy admin role");
      }
    }
    const subjectUserId = isSubjectOverride ? body.subjectUserId! : actor.userId;
    const subjectRoles = isSubjectOverride ? [] : actor.roles;

    // Resolve the granted permissions for the subject from the binding store
    // (scoped to actor.tenantId), never from client-asserted permissions.
    // RLS (#146): resolution + audit run inside the EVALUATED actor's tenant
    // context so the GUC transaction admits the reads and the outbox write —
    // for external callers actor.tenantId IS ctx.tenantId; trusted internal
    // callers may evaluate a principal of another tenant.
    return runWithTenant(actor.tenantId, async () => {
    const granted = await repo.findGrantedPermissions(actor.tenantId, subjectUserId, subjectRoles);

    // EPIC-2 (G-09/G-10): run RBAC then ABAC. Subject org attributes come from
    // the authenticated context (office/position/jurisdiction claims); ABAC deny
    // rules fence by jurisdiction even when the role grants the action. For a
    // trusted internal caller supplying an explicit actor, subject attrs may be
    // passed alongside; otherwise they derive from ctx.
    const [roleIds, compiledRules] = await Promise.all([
      repo.resolveRoleIds(actor.tenantId, subjectUserId, subjectRoles),
      loadCompiledRules(actor.tenantId),
    ]);
    // For a subject-override (admin evaluating another user) the caller's own
    // ctx org attributes must NOT leak into the subject's attribute bag — the
    // subject's attrs are unknown here, so start empty.
    const subjectAttrs: AttrBag = isSubjectOverride
      ? {}
      : {
          ...(ctx.officeId ? { officeId: ctx.officeId } : {}),
          ...(ctx.positionId ? { positionId: ctx.positionId } : {}),
          ...(ctx.deptCode ? { deptCode: ctx.deptCode } : {}),
          ...(ctx.hierarchyDomain ? { hierarchyDomain: ctx.hierarchyDomain } : {}),
          ...(ctx.jurisdictionUnitIds ? { jurisdictionUnitIds: ctx.jurisdictionUnitIds } : {}),
          ...(ctx.clearanceLevel ? { clearanceLevel: ctx.clearanceLevel } : {}),
          ...(isInternalCaller && body.subjectAttrs ? body.subjectAttrs : {}),
        };
    const result = evaluateWithAbac({
      permissionKey: body.permissionKey,
      userId: subjectUserId,
      tenantId: actor.tenantId,
      roles: subjectRoles,
      roleIds,
      subjectAttrs,
      resource: (body.resource ?? {}) as AttrBag,
      granted,
      compiledRules,
    });

    await db.transaction(async (tx) => {
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: actor.tenantId,
        // Subject override: audit under the admin asking. Otherwise keep the evaluated actor
        // (trusted internal callers pass an explicit actor distinct from the service principal).
        actorId: isSubjectOverride ? ctx.actorId : actor.userId,
        correlationId: ctx.correlationId,
        payload: {
          permissionKey: body.permissionKey,
          decision: result.decision,
          reason: result.reason,
          resource: body.resource ?? null,
          subjectUserId,
          onBehalfOf: isSubjectOverride ? subjectUserId : null,
        },
      });
    });

    return reply.send({ ...result, subjectUserId });
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
