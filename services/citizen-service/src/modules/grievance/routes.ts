import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import { CitizenRequestSummaryListSchema } from "@civitasone/schemas/web";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, resolveCitizenId, isOfficer, assertOwnership, HttpError } from "../../shared/context.js";
import {
  idParam, citizenIdQuery, registerGrievanceBody, assignGrievanceBody,
  grievanceActionBody, resolveGrievanceBody, escalateGrievanceBody, reopenGrievanceBody,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const CITIZEN_ROLES = ["citizen", "citizen_officer", "citizen_admin", "super_admin"];
const OFFICER_ROLES = ["citizen_officer", "citizen_admin", "super_admin"];

export async function grievanceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/citizen", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    return reply.send({
      module: "citizen",
      endpoints: ["/requests", "/grievances", "/rti", "/tickets"],
      tenantId: ctx.tenantId,
    });
  });

  app.post("/v1/citizen/grievances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const body = registerGrievanceBody.parse(req.body);
    // P0-3: constrain citizenId to the actor unless an officer specifies another.
    const citizenId = resolveCitizenId(ctx, body.citizenId);
    return sendAccepted(reply, acceptedResponseSchema, await commands.registerGrievance(ctx, { ...body, citizenId }));
  });

  app.patch("/v1/citizen/grievances/:id/assign", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = assignGrievanceBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.assignGrievance(ctx, id, body));
  });

  app.post("/v1/citizen/grievances/:id/actions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = grievanceActionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.addAction(ctx, id, body));
  });

  app.patch("/v1/citizen/grievances/:id/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = resolveGrievanceBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.resolveGrievance(ctx, id, body));
  });

  app.patch("/v1/citizen/grievances/:id/escalate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = escalateGrievanceBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.escalateGrievance(ctx, id, body));
  });

  /* C-03: Citizen can reopen a resolved grievance within 30 days (CPGRAMS rule) */
  app.patch("/v1/citizen/grievances/:id/reopen", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = reopenGrievanceBody.parse(req.body);
    // P0-1: load + assert ownership so a citizen cannot reopen another's grievance.
    const grievance = await queries.getGrievance(ctx.tenantId, id);
    if (!grievance) throw new HttpError(404, "NOT_FOUND", "grievance not found");
    assertOwnership(ctx, grievance.citizenId);
    return sendAccepted(reply, acceptedResponseSchema, await commands.reopenGrievance(ctx, id, { ...body, ownerCitizenId: grievance.citizenId }));
  });

  app.get("/v1/citizen/grievances/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const grievance = await queries.getGrievance(ctx.tenantId, id);
    if (!grievance) throw new HttpError(404, "NOT_FOUND", "grievance not found");
    // P0-1: a citizen may only read their own grievance; officers may read any.
    assertOwnership(ctx, grievance.citizenId);
    return reply.send(grievance);
  });

  app.get("/v1/citizen/grievances", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { citizenId } = citizenIdQuery.parse(req.query);
    // P0-3: a citizen is constrained to their own records; officers may filter
    // by an arbitrary citizenId, or omit it to list across the tenant.
    if (isOfficer(ctx) && citizenId === undefined) {
      return reply.send(await queries.listAllGrievances(ctx.tenantId));
    }
    const scopedCitizenId = resolveCitizenId(ctx, citizenId);
    return reply.send(await queries.listGrievances(ctx.tenantId, scopedCitizenId));
  });

  app.get("/v1/citizen/requests", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, CitizenRequestSummaryListSchema, await queries.listRequests(ctx.tenantId, q.limit, q.offset));
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
