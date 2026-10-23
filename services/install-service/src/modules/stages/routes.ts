import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createStageBody, idParam, stagesListSchema, stepVerbParam } from "./validators.js";
import { InstallStepSummaryListSchema } from "@civitasone/schemas/web";
import * as commands from "./commands.js";
import * as domainPackCommands from "./domain-pack-commands.js";
import * as queries from "./queries.js";
import { MUNICIPAL_ONBOARDING_PACK_KEYS } from "../orchestrator/domain-pack-constants.js";

const ROLES = ["install_user","install_admin","super_admin","tenant_admin"];
// SEC: install_user is READ-ONLY (provisioning treats it as reader-only). Every
// mutation (create stage, run/skip/retry a step, activate a domain pack) is
// restricted to the install admin roles.
const MUTATE_ROLES = ["install_admin","super_admin","tenant_admin"];

const STEP_STATUSES = ["pending", "in_progress", "completed", "failed", "skipped"] as const;
type StepStatus = (typeof STEP_STATUSES)[number];

// GAP-TENANT-ADMIN-INSTALL-05: steps and stages are NOT two different
// resources at two granularities — `/v1/install/steps` is a 1:1 view over the
// SAME stage rows that `/v1/install/stages` returns (one step per stage,
// carrying the stage's own status). This helper is the single mapping used by
// the steps route so the invariant "step[i].status is derived purely from
// stage[i].status, 1:1" is pinned by a test and cannot silently drift into a
// rollup that disagrees with the stages endpoint.
export function stageToStep(stage: {
  id: string;
  stepNumber: number;
  name: string;
  description?: string | null;
  status: string;
  isRequired?: boolean;
  completedAt?: string | null;
  errorMessage?: string | null;
}): {
  id: string;
  stepNo: number;
  title: string;
  description: string | undefined;
  isRequired: boolean;
  status: StepStatus;
  completedAt: string | undefined;
  errorMessage: string | undefined;
} {
  return {
    id: stage.id,
    stepNo: stage.stepNumber,
    title: stage.name,
    description: stage.description ?? undefined,
    isRequired: stage.isRequired ?? true,
    // Real status, incl. "failed" (previously collapsed to "pending", which hid
    // failures and offered Run instead of Retry). Unknown values stay "pending"
    // so a stray status never fabricates completion.
    status: (STEP_STATUSES as readonly string[]).includes(stage.status) ? (stage.status as StepStatus) : "pending",
    completedAt: stage.completedAt ?? undefined,
    errorMessage: stage.errorMessage ?? undefined,
  };
}

const activateDomainPackBody = z.object({
  domainPackKey: z.string().min(1).max(64).optional().default("municipal-in-v1"),
  packKeys: z.array(z.string().min(1).max(64)).max(50).optional(),
});

const domainPackActivateAcceptedSchema = z.object({
  id: z.string().uuid(),
  status: z.literal("accepted"),
  correlationId: z.string(),
  domainPackKey: z.string(),
  stageNumber: z.literal(3),
  packKeys: z.array(z.string()),
});

export async function stagesRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/install/stages", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, MUTATE_ROLES);
    const body = createStageBody.parse(req.body);
    sendAccepted(reply, acceptedResponseSchema, await commands.createStage(ctx, body));
  });

  app.get("/v1/install/stages", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    sendValidated(reply, stagesListSchema, await queries.listStages(ctx.tenantId, q.limit, q.offset));
  });

  app.get("/v1/install/steps", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const q = listQuerySchema.parse(req.query);
    const result = await queries.listStages(ctx.tenantId, q.limit, q.offset);
    sendValidated(reply, InstallStepSummaryListSchema, result.data.map(stageToStep));
  });

  app.get("/v1/install/stages/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = idParam.parse(req.params);
    const row = await queries.getStage(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "NOT_FOUND", "stage not found");
    return reply.send(row);
  });

  /**
   * FN-17 — Install Stage 3: activate a Domain Pack (default municipal-in-v1).
   * Publishes citizen.pack.domain_activate so TL / PGR / Water become editable drafts.
   */
  app.post("/v1/install/stages/3/domain-pack/activate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, MUTATE_ROLES);
    const body = activateDomainPackBody.parse(req.body ?? {});
    const accepted = await domainPackCommands.activateDomainPackStage3(ctx, {
      domainPackKey: body.domainPackKey,
      packKeys: body.packKeys ?? [...MUNICIPAL_ONBOARDING_PACK_KEYS],
    });
    sendAccepted(reply, domainPackActivateAcceptedSchema, {
      ...accepted,
      status: "accepted" as const,
      stageNumber: 3 as const,
    });
  });

  /** PATCH /v1/install/steps/:id/:verb — trigger step lifecycle (run, skip, retry) */
  app.patch("/v1/install/steps/:id/:verb", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, MUTATE_ROLES);
    const { id, verb } = stepVerbParam.parse(req.params);
    sendAccepted(reply, acceptedResponseSchema, await commands.transitionStage(ctx, id, verb));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
