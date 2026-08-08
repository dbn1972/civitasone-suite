import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import {
  createWizardBody,
  completeStepBody,
  skipStepBody,
  wizardIdParam,
  stepKeyParam,
  wizardProgressView,
  wizardsListSchema,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import { defaultOnboardingSteps, ONBOARDING_WIZARD_NAME } from "./onboarding.js";

const ROLES = ["install_user", "install_admin", "super_admin", "tenant_admin"];

export async function orchestratorRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/install/wizards", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = createWizardBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.createWizard(ctx, body));
  });

  /** FN-17 — create the standard tenant onboarding wizard (Stage 3 = Domain Pack). */
  app.post("/v1/install/wizards/onboarding", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const domainPackKey =
      typeof (req.body as { domainPackKey?: string } | null)?.domainPackKey === "string"
        ? (req.body as { domainPackKey: string }).domainPackKey
        : "municipal-in-v1";
    sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.createWizard(ctx, {
        name: ONBOARDING_WIZARD_NAME,
        description: "ULB / tenant onboarding — Stage 3 activates a Domain Pack into editable drafts.",
        steps: defaultOnboardingSteps(domainPackKey),
      }),
    );
  });

  app.get("/v1/install/wizards", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, wizardsListSchema, await queries.listWizards(ctx.tenantId, q.limit, q.offset));
  });

  app.get("/v1/install/wizards/:wizardId/progress", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { wizardId } = wizardIdParam.parse(req.params);
    const progress = await queries.getWizardProgress(wizardId, ctx.tenantId);
    if (!progress) throw new HttpError(404, "NOT_FOUND", "wizard not found");
    sendValidated(reply, wizardProgressView, progress);
  });

  app.post("/v1/install/wizards/:wizardId/steps/:stepKey/start", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { wizardId, stepKey } = stepKeyParam.parse(req.params);
    sendAccepted(reply, acceptedResponseSchema, await commands.startStep(ctx, wizardId, stepKey));
  });

  app.post("/v1/install/wizards/:wizardId/steps/:stepKey/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { wizardId, stepKey } = stepKeyParam.parse(req.params);
    const body = completeStepBody.parse(req.body ?? {});
    sendAccepted(reply, acceptedResponseSchema, await commands.completeStep(ctx, wizardId, stepKey, body));
  });

  app.post("/v1/install/wizards/:wizardId/steps/:stepKey/skip", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { wizardId, stepKey } = stepKeyParam.parse(req.params);
    const body = skipStepBody.parse(req.body ?? {});
    sendAccepted(reply, acceptedResponseSchema, await commands.skipStep(ctx, wizardId, stepKey, body.reason));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
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
