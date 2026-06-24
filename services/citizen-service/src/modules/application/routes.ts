import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, resolveCitizenId, isOfficer, assertOwnership, HttpError } from "../../shared/context.js";
import { idParam, citizenIdQuery, submitApplicationBody, statusUpdateBody, docUploadBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const CITIZEN_ROLES  = ["citizen", "citizen_officer", "citizen_admin", "super_admin"];
const OFFICER_ROLES  = ["citizen_officer", "citizen_admin", "super_admin"];

export async function applicationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/citizen/applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const body = submitApplicationBody.parse(req.body);
    // P0-3: constrain citizenId to the actor unless an officer specifies another.
    const citizenId = resolveCitizenId(ctx, body.citizenId);
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitApplication(ctx, { ...body, citizenId }));
  });

  app.patch("/v1/citizen/applications/:id/status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = statusUpdateBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateStatus(ctx, id, body));
  });

  app.post("/v1/citizen/applications/:id/documents", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = docUploadBody.parse(req.body);
    // P0-1: load + assert ownership so a citizen cannot attach docs to another's application.
    const owner = await queries.getApplication(ctx.tenantId, id);
    if (!owner) throw new HttpError(404, "NOT_FOUND", "application not found");
    assertOwnership(ctx, owner.citizenId);
    return sendAccepted(reply, acceptedResponseSchema, await commands.uploadDocument(ctx, id, { ...body, ownerCitizenId: owner.citizenId }));
  });

  app.get("/v1/citizen/applications/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const app = await queries.getApplication(ctx.tenantId, id);
    if (!app) throw new HttpError(404, "NOT_FOUND", "application not found");
    // P0-1: a citizen may only read their own application (incl. history/documents).
    assertOwnership(ctx, app.citizenId);
    return reply.send(app);
  });

  app.get("/v1/citizen/applications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { citizenId } = citizenIdQuery.parse(req.query);
    // P0-3: citizen constrained to self; officers may filter by any id or list all.
    if (isOfficer(ctx) && citizenId === undefined) {
      return reply.send(await queries.listAllApplications(ctx.tenantId));
    }
    const scopedCitizenId = resolveCitizenId(ctx, citizenId);
    return reply.send(await queries.listApplications(ctx.tenantId, scopedCitizenId));
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
