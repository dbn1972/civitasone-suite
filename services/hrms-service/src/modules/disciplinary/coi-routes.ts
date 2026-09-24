import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * 0176 — COI / confidentiality declaration routes.
 *
 *   POST   /v1/hrms/employees/:id/declarations        file a declaration
 *   GET    /v1/hrms/employees/:id/declarations        list declarations
 *   POST   /v1/hrms/declarations/:declId/revoke       revoke a declaration
 *   POST   /v1/hrms/declarations/:declId/acknowledge  employee acknowledges
 *
 * CCS (Conduct) Rules: an employee must declare conflicts of interest,
 * property beyond means, outside employment, gifts received, and sign
 * confidentiality undertakings. These are tracked with full audit trail.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RequestContext } from "@civitasone/types";
import { z, ZodError } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsCoiDeclarations } from "./schema.js";
import { hrmsEmployees } from "../employee/schema.js";
import { resolveEmployeeForActor, extractActorEmail } from "../employee/actor-link.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const VIGILANCE_ROLES = [...HR_ROLES, "vigilance_officer"];
const ALL_ROLES = [...HR_ROLES, "employee", "manager"];

const DECL_TYPES = ["coi", "confidentiality", "property", "gift", "outside_employment"] as const;
const idParam = z.object({ id: z.string().uuid() });
const declIdParam = z.object({ declId: z.string().uuid() });

/**
 * IDOR fix (audit: COI declarations — read, forge, and false-acknowledge).
 * ALL_ROLES lets a bare employee/manager hit any :id/declId with zero
 * ownership check: file a fabricated declaration attributed to a colleague
 * (only the target employee's existence-in-tenant was checked, never that it
 * was the caller), read a colleague's declaration, or falsely mark any
 * colleague's declaration "acknowledged".
 *
 * Resolves the caller's OWN hrms_employees row via resolveEmployeeForActor
 * (userRef = actorId, email fallback) — the same primitive medical/routes.ts's
 * resolveSelfScopedEmployeeId and employee/routes.ts's resolveManagerScope
 * already use — deliberately NOT a raw `ctx.actorId === employeeId`
 * comparison: actorId is the JWT subject, a different id space from
 * hrms_employees.id (see actor-link.ts).
 *
 * VIGILANCE_ROLES (HR + vigilance_officer) keep unrestricted, tenant-wide
 * access — matches this file's own pre-existing revoke route, which already
 * reserves revoke for that exact set. A bare "manager" is deliberately NOT
 * treated as privileged here: there is no "manager sees a report's COI"
 * business case documented anywhere in this module (unlike leave/attendance),
 * and revoke's existing role list already excludes manager, so employee and
 * manager are scoped identically — both may only ever act on their own
 * declaration.
 *
 * Throws 403 (not a disguised 404) when the caller is neither privileged nor
 * the declaration's own subject — matches employee/routes.ts's identical
 * "not self, not a direct report" 403 precedent; the employee id-space is an
 * unguessable UUID, so this doesn't meaningfully aid enumeration.
 */
async function assertOwnEmployeeOrPrivileged(
  ctx: RequestContext,
  req: FastifyRequest,
  targetEmployeeId: string,
): Promise<void> {
  if (VIGILANCE_ROLES.some((r) => ctx.roles.includes(r))) return;
  const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId, extractActorEmail(req));
  if (!actorEmp || actorEmp.id !== targetEmployeeId) {
    throw new HttpError(403, "FORBIDDEN", "you may only access your own declarations");
  }
}

export async function coiDeclarationRoutes(app: FastifyInstance): Promise<void> {
  // File a new declaration
  app.post("/v1/hrms/employees/:id/declarations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      declarationType: z.enum(DECL_TYPES),
      declarationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      details: z.string().min(1).max(8000),
    }).parse(req.body);

    // IDOR guard: must run before the existence check below so a
    // non-privileged caller targeting an arbitrary :id doesn't learn whether
    // that id exists in the tenant.
    await assertOwnEmployeeOrPrivileged(ctx, req, id);

    // Verify employee exists in tenant
    const emp = await scopedRead((tx) =>
      tx.select({ id: hrmsEmployees.id }).from(hrmsEmployees)
        .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, ctx.tenantId)))
        .limit(1),
    );
    if (!emp[0]) throw new HttpError(404, "NOT_FOUND", "employee not found");

    const declId = randomUUID();
    await publishF3Write(ctx, "disciplinary_coi_routes__0", declId, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })

    return reply.code(201).send({
      data: { id: declId, employeeId: id, declarationType: body.declarationType, status: "active" },
    }) as any;
  });

  // List declarations for an employee
  app.get("/v1/hrms/employees/:id/declarations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { id } = idParam.parse(req.params);
    const query = z.object({
      declarationType: z.enum(DECL_TYPES).optional(),
      status: z.enum(["active", "revoked", "expired", "superseded"]).optional(),
    }).parse(req.query);

    // IDOR guard: closes the "read a colleague's declaration" leak.
    await assertOwnEmployeeOrPrivileged(ctx, req, id);

    const rows = await scopedRead(async (tx) => {
      let q = tx.select().from(hrmsCoiDeclarations)
        .where(and(
          eq(hrmsCoiDeclarations.tenantId, ctx.tenantId),
          eq(hrmsCoiDeclarations.employeeId, id),
          ...(query.declarationType ? [eq(hrmsCoiDeclarations.declarationType, query.declarationType)] : []),
          ...(query.status ? [eq(hrmsCoiDeclarations.status, query.status)] : []),
        ))
        .orderBy(desc(hrmsCoiDeclarations.declarationDate))
        .limit(100);
      return q;
    });

    return reply.send({ data: rows });
  });

  // Revoke a declaration
  app.post("/v1/hrms/declarations/:declId/revoke", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VIGILANCE_ROLES);
    const { declId } = declIdParam.parse(req.params);
    const body = z.object({
      reason: z.string().min(1).max(2000),
    }).parse(req.body);

    // Synchronous pre-check (state-transition legality): the consumer's
    // disciplinary_coi_routes__1 case already 404s on an unknown declaration
    // and 409s ("WRONG_STATE") when it is not 'active', but only after the
    // route has already replied 200 -- a caller revoking an already-revoked
    // declaration saw a false-positive success while the write was silently
    // dropped. Mirror the same check here, synchronously, before publishing
    // -- same pattern as cpf/routes.ts and hold-routes.ts.
    const declRows = await scopedRead((tx) =>
      tx.select({ id: hrmsCoiDeclarations.id, status: hrmsCoiDeclarations.status }).from(hrmsCoiDeclarations)
        .where(and(eq(hrmsCoiDeclarations.id, declId), eq(hrmsCoiDeclarations.tenantId, ctx.tenantId)))
        .limit(1),
    );
    const decl = declRows[0];
    if (!decl) throw new HttpError(404, "NOT_FOUND", "declaration not found");
    if (decl.status !== "active") {
      throw new HttpError(409, "WRONG_STATE", `declaration is '${decl.status}', cannot revoke`);
    }

    await publishF3Write(ctx, "disciplinary_coi_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })

    return reply.send({ data: { id: declId, status: "revoked" } }) as any;
  });

  // Acknowledge a declaration (employee confirms receipt/understanding)
  app.post("/v1/hrms/declarations/:declId/acknowledge", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const { declId } = declIdParam.parse(req.params);

    // IDOR fix (audit: any employee/manager could acknowledge ANY colleague's
    // declaration — no subject check existed here or in the consumer).
    // Fetching the row synchronously also closes the same false-positive-200
    // gap the revoke route above was already fixed for: previously this
    // always replied 200 "acknowledged" even for an unknown/non-active
    // declId, with the consumer's 404/409 only surfacing after the fact.
    const declRows = await scopedRead((tx) =>
      tx.select({ id: hrmsCoiDeclarations.id, status: hrmsCoiDeclarations.status, employeeId: hrmsCoiDeclarations.employeeId })
        .from(hrmsCoiDeclarations)
        .where(and(eq(hrmsCoiDeclarations.id, declId), eq(hrmsCoiDeclarations.tenantId, ctx.tenantId)))
        .limit(1),
    );
    const decl = declRows[0];
    if (!decl) throw new HttpError(404, "NOT_FOUND", "declaration not found");
    await assertOwnEmployeeOrPrivileged(ctx, req, decl.employeeId);
    if (decl.status !== "active") {
      throw new HttpError(409, "WRONG_STATE", `declaration is '${decl.status}', cannot acknowledge`);
    }

    await publishF3Write(ctx, "disciplinary_coi_routes__2", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })

    return reply.send({ data: { id: declId, acknowledged: true } }) as any;
  });

  // Error handler
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
