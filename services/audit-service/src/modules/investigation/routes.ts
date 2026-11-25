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

// Owner decision B4: investigation subject/findings (and the CSV built from them) are visible ONLY to these roles.
// tenant_admin and super_admin are deliberately NOT included; the same set may assign and close.
export const INVESTIGATION_ROLES = ["audit_admin", "audit_officer", "vigilance_admin"];

export async function investigationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/audit/investigations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INVESTIGATION_ROLES);
    const q = listQuerySchema.parse(req.query);
    return reply.send(await queries.listInvestigations(ctx.tenantId, q.limit));
  });

  app.get("/v1/audit/investigations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INVESTIGATION_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await queries.getInvestigation(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "investigation not found");
    return reply.send(row);
  });

  // GAP-AUDIT-INVESTIGATION-05: assign / close. 404 + 409 pre-checks here; the consumer is the race-safe authority.
  app.patch("/v1/audit/investigations/:id/assign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INVESTIGATION_ROLES);
    const { id } = idParam.parse(req.params);
    const body = assignBody.parse(req.body);
    const row = await queries.getInvestigation(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "investigation not found");
    guard(() => assertCanAssign(row.status));
    return sendAccepted(reply, acceptedResponseSchema, await commands.assignInvestigation(ctx, id, body));
  });

  app.patch("/v1/audit/investigations/:id/close", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, INVESTIGATION_ROLES);
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
