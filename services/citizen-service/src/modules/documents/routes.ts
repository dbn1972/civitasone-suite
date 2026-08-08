import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, resolveCitizenId, isOfficer, assertOwnership, HttpError } from "../../shared/context.js";
import {
  idParam, uploadBody, digilockerFetchBody, verifyBody, resubmitBody,
  checklistQuery, applicationQuery,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const CITIZEN_ROLES = ["citizen", "citizen_officer", "citizen_admin", "super_admin"];
const OFFICER_ROLES = ["citizen_officer", "citizen_admin", "super_admin"];

export async function documentsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/citizen/documents/upload", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const body = uploadBody.parse(req.body);
    const citizenId = resolveCitizenId(ctx, body.citizenId);
    return sendAccepted(reply, acceptedResponseSchema, await commands.upload(ctx, { ...body, citizenId }));
  });

  app.post("/v1/citizen/documents/digilocker-fetch", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const body = digilockerFetchBody.parse(req.body);
    const citizenId = resolveCitizenId(ctx, body.citizenId);
    return sendAccepted(reply, acceptedResponseSchema, await commands.digilockerFetchIntake(ctx, { ...body, citizenId }));
  });

  app.get("/v1/citizen/documents/checklist", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { serviceId, applicationId, laneKey } = checklistQuery.parse(req.query);
    return reply.send(await queries.checklist(ctx.tenantId, serviceId, applicationId, laneKey));
  });

  /** FN-26 — officer lane checklist alias (same handler, clearer intent). */
  app.get("/v1/citizen/documents/verification-lane", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { serviceId, applicationId, laneKey } = checklistQuery.parse(req.query);
    if (!laneKey) throw new HttpError(400, "VALIDATION_FAILED", "laneKey is required");
    return reply.send(await queries.checklist(ctx.tenantId, serviceId, applicationId, laneKey));
  });

  app.get("/v1/citizen/documents/pending", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    return reply.send({ data: await queries.listPendingVerification(ctx.tenantId) });
  });

  app.get("/v1/citizen/documents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { applicationId } = applicationQuery.parse(req.query);
    if (isOfficer(ctx)) {
      return reply.send({ data: await queries.listByApplication(ctx.tenantId, applicationId) });
    }
    const scopedCitizenId = resolveCitizenId(ctx, undefined);
    return reply.send({ data: await queries.listByApplicationForCitizen(ctx.tenantId, applicationId, scopedCitizenId) });
  });

  app.get("/v1/citizen/documents/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const sub = await queries.getSubmission(ctx.tenantId, id);
    if (!sub) throw new HttpError(404, "NOT_FOUND", "document submission not found");
    assertOwnership(ctx, sub.citizenId);
    return reply.send(sub);
  });

  app.post("/v1/citizen/documents/:id/verify", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = verifyBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.verify(ctx, id, body));
  });

  app.post("/v1/citizen/documents/:id/resubmit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = resubmitBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.resubmit(ctx, id, body));
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
