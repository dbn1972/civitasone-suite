import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
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
    return reply.code(201).send(await commands.upload(ctx, body));
  });

  app.post("/v1/citizen/documents/digilocker-fetch", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const body = digilockerFetchBody.parse(req.body);
    return reply.code(201).send(await commands.digilockerFetchIntake(ctx, body));
  });

  app.get("/v1/citizen/documents/checklist", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { serviceId, applicationId } = checklistQuery.parse(req.query);
    return reply.send(await commands.checklist(ctx, serviceId, applicationId));
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
    return reply.send({ data: await queries.listByApplication(ctx.tenantId, applicationId) });
  });

  app.get("/v1/citizen/documents/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const sub = await queries.getSubmission(ctx.tenantId, id);
    if (!sub) throw new HttpError(404, "NOT_FOUND", "document submission not found");
    return reply.send(sub);
  });

  app.post("/v1/citizen/documents/:id/verify", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = verifyBody.parse(req.body);
    return reply.send(await commands.verify(ctx, id, body));
  });

  app.post("/v1/citizen/documents/:id/resubmit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = resubmitBody.parse(req.body);
    return reply.code(201).send(await commands.resubmit(ctx, id, body));
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
