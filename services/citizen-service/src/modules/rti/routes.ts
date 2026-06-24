import { sendAccepted, sendValidated } from "@civitasone/schemas/validate";
import { acceptedResponseSchema, listQuerySchema } from "@civitasone/schemas/common";
import { RTISummaryListSchema } from "@civitasone/schemas/web";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, resolveCitizenId, isOfficer, assertOwnership, HttpError } from "../../shared/context.js";
import { idParam, fileRtiBody, respondRtiBody, appealRtiBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const CITIZEN_ROLES  = ["citizen", "citizen_officer", "citizen_admin", "super_admin"];
const OFFICER_ROLES  = ["citizen_officer", "citizen_admin", "super_admin"];

export async function rtiRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/citizen/rti", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const body = fileRtiBody.parse(req.body);
    // P0-1: constrain citizenId to the actor unless an officer specifies another.
    const citizenId = resolveCitizenId(ctx, body.citizenId);
    return sendAccepted(reply, acceptedResponseSchema, await commands.fileRti(ctx, { ...body, citizenId }));
  });

  app.post("/v1/citizen/rti/:id/respond", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = respondRtiBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.respondRti(ctx, id, body));
  });

  app.patch("/v1/citizen/rti/:id/appeal", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = appealRtiBody.parse(req.body);
    // P0-1: load + assert ownership so a citizen cannot appeal another's RTI.
    const owner = await queries.getRti(ctx.tenantId, id);
    if (!owner) throw new HttpError(404, "NOT_FOUND", "rti request not found");
    assertOwnership(ctx, owner.citizenId);
    return sendAccepted(reply, acceptedResponseSchema, await commands.appealRti(ctx, id, { ...body, ownerCitizenId: owner.citizenId }));
  });

  app.get("/v1/citizen/rti", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const q = listQuerySchema.parse(req.query);
    // P0-1: a bare citizen only sees their own RTIs; officers see the tenant view.
    const ownCitizenId = isOfficer(ctx) ? undefined : ctx.actorId;
    sendValidated(reply, RTISummaryListSchema, await queries.listRtiSummaries(ctx.tenantId, q.limit, ownCitizenId));
  });

  /** RTI Act 2005 §7: list RTIs that have breached the 30-day deadline without response (officer view).
   * P1-3: MUST be registered before GET /rti/:id so the static path is not
   * swallowed by the :id param route (which would 400 on "overdue"). */
  app.get("/v1/citizen/rti/overdue", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    return reply.send(await queries.listOverdueRti(ctx.tenantId));
  });

  app.get("/v1/citizen/rti/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const rti = await queries.getRti(ctx.tenantId, id);
    if (!rti) throw new HttpError(404, "NOT_FOUND", "rti request not found");
    // P0-1: a citizen may only read their own RTI; officers may read any.
    assertOwnership(ctx, rti.citizenId);
    return reply.send(rti);
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
