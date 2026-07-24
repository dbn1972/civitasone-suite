import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { idParam, trackingParam, saveDraftBody, updateDraftBody, submitDraftBody } from "./intake-validators.js";
import * as intake from "./intake.js";

const CITIZEN_ROLES = ["citizen", "citizen_officer", "citizen_admin", "super_admin"];

export async function intakeRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/citizen/intake/drafts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const body = saveDraftBody.parse(req.body);
    return reply.code(201).send(await intake.saveDraft(ctx, body));
  });

  app.get("/v1/citizen/intake/drafts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const citizenId = typeof (req.query as { citizenId?: string })?.citizenId === "string"
      ? (req.query as { citizenId?: string }).citizenId : undefined;
    return reply.send({ data: await intake.listDrafts(ctx, citizenId) });
  });

  app.get("/v1/citizen/intake/drafts/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const draft = await intake.getDraft(ctx, id);
    if (!draft) throw new HttpError(404, "NOT_FOUND", "draft not found");
    return reply.send(draft);
  });

  app.patch("/v1/citizen/intake/drafts/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateDraftBody.parse(req.body ?? {});
    return reply.send(await intake.updateDraft(ctx, id, body));
  });

  app.post("/v1/citizen/intake/drafts/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = submitDraftBody.parse(req.body ?? {});
    return reply.code(201).send(await intake.submitDraft(ctx, id, body));
  });

  app.get("/v1/citizen/intake/track/:trackingNo", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { trackingNo } = trackingParam.parse(req.params);
    const ack = await intake.trackByNumber(ctx, trackingNo);
    if (!ack) throw new HttpError(404, "NOT_FOUND", "no acknowledgement for tracking number");
    return reply.send(ack);
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
