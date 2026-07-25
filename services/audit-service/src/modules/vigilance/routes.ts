import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import {
  idParam, actionIdParam, intakeBody, screenBody, assignIoBody,
  evidenceBody, findingsBody, proposeActionBody, decideActionBody,
} from "./validators.js";

// Summary list stays visible to audit leadership (unchanged behaviour).
const READER_ROLES = ["audit_officer", "audit_admin", "super_admin", "vigilance_officer", "vigilance_admin"];
// RESTRICTED: the confidential case FILE + all write operations are vigilance-only.
const VIGILANCE_ROLES = ["vigilance_officer", "vigilance_admin", "super_admin"];
// Maker-checker authority: only a disciplinary authority decides an action.
const AUTHORITY_ROLES = ["vigilance_admin", "super_admin"];

export async function vigilanceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/audit/vigilance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    return reply.send(await queries.listVigilanceCases(ctx.tenantId, q.limit));
  });

  // RESTRICTED ACCESS: confidential case file — vigilance roles only.
  app.get("/v1/audit/vigilance/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VIGILANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const file = await queries.getCaseFile(ctx.tenantId, id);
    if (!file) throw new HttpError(404, "NOT_FOUND", "vigilance case not found");
    return reply.send(file);
  });

  app.post("/v1/audit/vigilance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VIGILANCE_ROLES);
    const body = intakeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.intakeCase(ctx, body));
  });

  app.patch("/v1/audit/vigilance/:id/screen", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VIGILANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = screenBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.screenCase(ctx, id, body));
  });

  app.patch("/v1/audit/vigilance/:id/assign-io", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VIGILANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = assignIoBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.assignIo(ctx, id, body));
  });

  app.post("/v1/audit/vigilance/:id/evidence", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VIGILANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = evidenceBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.addEvidence(ctx, id, body));
  });

  app.patch("/v1/audit/vigilance/:id/findings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VIGILANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = findingsBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.recordFindings(ctx, id, body));
  });

  app.post("/v1/audit/vigilance/:id/actions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, VIGILANCE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = proposeActionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.proposeAction(ctx, id, body));
  });

  // Maker-checker: a disciplinary authority (never the proposer) decides.
  app.patch("/v1/audit/vigilance/:id/actions/:actionId/decision", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, AUTHORITY_ROLES);
    const { actionId } = actionIdParam.parse(req.params);
    const body = decideActionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.decideAction(ctx, actionId, body));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
