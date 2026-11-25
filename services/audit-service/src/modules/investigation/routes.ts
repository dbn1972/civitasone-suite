import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import * as queries from "./queries.js";
import * as commands from "./commands.js";
import { assignBody, closeBody, idParam } from "./validators.js";
import { assertCanAssign, assertCanClose, DomainError } from "./domain.js";

// Owner decision B4: investigation subject/findings (and the CSV built from them) are NOT visible to tenant_admin.
// READ keeps every prior reader (audit_officer, audit_admin, super_admin, vigilance_officer) and adds vigilance_admin.
export const INVESTIGATION_READ_ROLES = ["audit_admin", "audit_officer", "vigilance_admin", "vigilance_officer", "super_admin"];
// ACT (assign / close) is tighter: vigilance_officer reads but does not act.
export const INVESTIGATION_ACT_ROLES = ["audit_admin", "audit_officer", "vigilance_admin", "super_admin"];

export async function investigationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/audit/investigations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INVESTIGATION_READ_ROLES);
    const q = listQuerySchema.parse(req.query);
    return reply.send(await queries.listInvestigations(ctx.tenantId, q.limit));
  });

  app.get("/v1/audit/investigations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INVESTIGATION_READ_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await queries.getInvestigation(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "investigation not found");
    return reply.send(row);
  });

  // GAP-AUDIT-INVESTIGATION-05: assign / close. 404 + 409 pre-checks here; the consumer is the race-safe authority.
  app.patch("/v1/audit/investigations/:id/assign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INVESTIGATION_ACT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = assignBody.parse(req.body);
    const row = await queries.getInvestigation(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "investigation not found");
    guard(() => assertCanAssign(row.status));
    return sendAccepted(reply, acceptedResponseSchema, await commands.assignInvestigation(ctx, id, body));
  });

  app.patch("/v1/audit/investigations/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INVESTIGATION_ACT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = closeBody.parse(req.body);
    const row = await queries.getInvestigation(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "investigation not found");
    guard(() => assertCanClose(row.status));
    return sendAccepted(reply, acceptedResponseSchema, await commands.closeInvestigation(ctx, id, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    // Fastify's own 4xx (e.g. FST_ERR_CTP_EMPTY_JSON_BODY) is a client error, not a 500.
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) return reply.code(status).send({ code: (err as { code?: string }).code ?? "BAD_REQUEST", message: "invalid request", correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}

function guard(fn: () => void): void {
  try { fn(); } catch (e) {
    if (e instanceof DomainError) throw new HttpError(409, e.code, e.message);
    throw e;
  }
}
