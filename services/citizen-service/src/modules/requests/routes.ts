import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import {
  resolveContext, requireRole, resolveCitizenId, assertOwnership, isOfficer, HttpError,
} from "../../shared/context.js";
import {
  idParam, createRequestBody, updateRequestBody, CITIZEN_SETTABLE_STATUSES,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const CITIZEN_ROLES = ["citizen", "citizen_officer", "citizen_admin", "super_admin"];

export async function serviceRequestRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/citizen/requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const body = createRequestBody.parse(req.body);
    // P0-3: constrain citizenId to the actor unless staff specify another.
    const citizenId = resolveCitizenId(ctx, body.citizenId);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createRequest(ctx, { ...body, citizenId }));
  });

  // NOTE: GET /v1/citizen/requests (list) is intentionally NOT defined here.
  // modules/grievance/routes.ts already serves a real, working list at that
  // exact path (a cross-cutting "citizen request summary" view, currently
  // sourced from grievances) — registering a second handler for the same
  // method+path throws at boot. This module only owns the :id-scoped routes.

  app.get("/v1/citizen/requests/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const request = await queries.getRequestWithOwner(ctx.tenantId, id);
    if (!request) throw new HttpError(404, "NOT_FOUND", "request not found");
    // P0-1: staff (officer-tier) may read any request; a bare citizen only their own.
    assertOwnership(ctx, request.citizenId);
    return reply.send({ data: request });
  });

  app.get("/v1/citizen/requests/:id/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const request = await queries.getRequestWithOwner(ctx.tenantId, id);
    if (!request) throw new HttpError(404, "NOT_FOUND", "request not found");
    assertOwnership(ctx, request.citizenId);
    const status = await queries.getRequestStatus(ctx.tenantId, id);
    return reply.send({ data: status });
  });

  app.patch("/v1/citizen/requests/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateRequestBody.parse(req.body);
    const current = await queries.getRequestWithOwner(ctx.tenantId, id);
    if (!current) throw new HttpError(404, "NOT_FOUND", "request not found");
    if (!isOfficer(ctx)) {
      // P0-1/P0-4: a bare citizen may only update their own request, and only
      // to withdraw it — they cannot set it to under_review/resolved/etc.
      assertOwnership(ctx, current.citizenId);
      if (body.status && !CITIZEN_SETTABLE_STATUSES.has(body.status)) {
        throw new HttpError(403, "FORBIDDEN", "citizens may only cancel their own request");
      }
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateRequest(ctx, id, body));
  });

  app.get("/v1/citizen/portal/metrics", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    return reply.send({ data: await queries.getPortalMetrics(ctx.tenantId) });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
