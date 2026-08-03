import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { idParam, grantConsentBody, revokeConsentBody, runDiscoveryBody, enrolBody } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { z } from "zod";

const OFFICER_ROLES = ["citizen_officer", "citizen_admin", "super_admin"];

const citizenQuery = z.object({ citizenId: z.string().uuid(), scope: z.string().max(48).optional() });

export async function discoveryRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/citizen/discovery/consent", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = grantConsentBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.grantConsent(ctx, body));
  });

  app.post("/v1/citizen/discovery/consent/revoke", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = revokeConsentBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.revokeConsent(ctx, body));
  });

  app.get("/v1/citizen/discovery/consent", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { citizenId, scope } = citizenQuery.parse(req.query);
    const consent = await queries.getConsent(ctx.tenantId, citizenId, scope ?? "benefit_discovery");
    return reply.send({ consent, active: Boolean(consent && consent.granted && !consent.revokedAt) });
  });

  app.post("/v1/citizen/discovery/run", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const body = runDiscoveryBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.runDiscovery(ctx, body));
  });

  app.get("/v1/citizen/discovery/matches", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { citizenId } = citizenQuery.parse(req.query);
    return reply.send({ data: await queries.listMatches(ctx.tenantId, citizenId) });
  });

  app.post("/v1/citizen/discovery/matches/:id/enrol", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, OFFICER_ROLES);
    const { id } = idParam.parse(req.params);
    const body = enrolBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.assistedEnrol(ctx, id, body));
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
