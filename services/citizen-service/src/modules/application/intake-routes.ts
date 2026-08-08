import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError, resolveCitizenId, isOfficer } from "../../shared/context.js";
import { idParam, trackingParam, saveDraftBody, updateDraftBody, submitDraftBody } from "./intake-validators.js";
import {
  buildTrackingNumber, resolveAssistedBy, isAssistedChannel, resolveAndGateApplicantType,
  ApplicantTypeRejectedError, type IntakeChannel,
} from "./intake-domain.js";
import * as intake from "./intake.js";
import * as commands from "./commands.js";

const CITIZEN_ROLES = ["citizen", "citizen_officer", "citizen_admin", "super_admin"];

function gateApplicantType(
  def: Awaited<ReturnType<typeof intake.resolveDefinitionForIntake>>,
  rawApplicantType: string | undefined,
): string {
  try {
    return resolveAndGateApplicantType({
      rawApplicantType,
      allowedApplicantTypes: def?.allowedApplicantTypes,
      rejectMessage: def?.applicantTypeRejectMessage,
    });
  } catch (e) {
    if (e instanceof ApplicantTypeRejectedError) {
      throw new HttpError(422, e.code, e.rejectMessage);
    }
    throw e;
  }
}

async function requireAllowedChannel(
  tenantId: string,
  channel: string,
  opts: { serviceId: string; serviceKey?: string | undefined },
): Promise<void> {
  try {
    await intake.enforceChannelAtIntake(tenantId, channel, opts);
  } catch (e) {
    if (e instanceof Error && e.name === "CHANNEL_NOT_ALLOWED") {
      throw new HttpError(422, "CHANNEL_NOT_ALLOWED", e.message);
    }
    throw e;
  }
}

export async function intakeRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/citizen/intake/drafts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const body = saveDraftBody.parse(req.body);
    const citizenId = resolveCitizenId(ctx, body.citizenId);
    const channel = body.channel as IntakeChannel;
    await requireAllowedChannel(ctx.tenantId, channel, {
      serviceId: body.serviceId,
      serviceKey: body.serviceKey,
    });
    const operatorId = isAssistedChannel(channel) ? (body.operatorId ?? ctx.actorId) : undefined;
    let assistedBy: string | null;
    try {
      assistedBy = resolveAssistedBy(channel, operatorId);
    } catch {
      throw new HttpError(422, "ASSISTED_OPERATOR_REQUIRED", "assisted/counter intake requires an operator id");
    }
    if (assistedBy && !isOfficer(ctx)) {
      throw new HttpError(403, "FORBIDDEN", "assisted intake requires an officer-tier operator");
    }
    const def = await intake.resolveDefinitionForIntake(ctx.tenantId, body.serviceId, body.serviceKey);
    const applicantType = gateApplicantType(def, body.applicantType);
    return sendAccepted(reply, acceptedResponseSchema, await commands.saveDraft(ctx, {
      citizenId,
      serviceId: body.serviceId,
      serviceKey: body.serviceKey,
      channel,
      assistedBy,
      applicantType,
      formData: body.formData,
      documentTypes: body.documentTypes,
    }));
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
    const draft = await intake.getDraft(ctx, id);
    if (!draft) throw new HttpError(404, "NOT_FOUND", "draft not found");
    if (draft.status !== "draft") throw new HttpError(409, "INVALID_STATE", "only a draft can be updated");
    let applicantType: string | undefined;
    if (body.applicantType !== undefined) {
      const def = await intake.resolveDefinitionForIntake(ctx.tenantId, draft.serviceId, draft.serviceKey);
      applicantType = gateApplicantType(def, body.applicantType);
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateDraft(ctx, id, {
      formData: body.formData,
      documentTypes: body.documentTypes,
      ...(applicantType !== undefined ? { applicantType } : {}),
    }));
  });

  app.post("/v1/citizen/intake/drafts/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CITIZEN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = submitDraftBody.parse(req.body ?? {});
    const draft = await intake.getDraft(ctx, id);
    if (!draft) throw new HttpError(404, "NOT_FOUND", "draft not found");
    if (draft.status !== "draft") throw new HttpError(409, "ALREADY_SUBMITTED", "draft has already been submitted");
    // FN-24 — re-check at submit so a channel disabled after draft save cannot be smuggled through.
    await requireAllowedChannel(ctx.tenantId, draft.channel, {
      serviceId: draft.serviceId,
      serviceKey: draft.serviceKey ?? undefined,
    });
    const def = await intake.resolveDefinitionForIntake(ctx.tenantId, draft.serviceId, draft.serviceKey);
    const applicantType = gateApplicantType(def, body.applicantType ?? draft.applicantType ?? undefined);
    const applicationId = randomUUID();
    const trackingNo = buildTrackingNumber();
    const accepted = await commands.submitDraft(ctx, id, {
      documentTypes: body.documentTypes,
      trackingNo,
      applicationId,
      channel: draft.channel,
      applicantType,
    });
    return reply.code(202).send(accepted);
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
