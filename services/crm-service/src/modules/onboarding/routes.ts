/**
 * Customer onboarding routes (P1-9).
 * GET  /v1/crm/onboarding-cases          — list (stage / accountId filters)
 * GET  /v1/crm/onboarding-cases/:id      — read one
 * POST /v1/crm/onboarding-cases/:id/stage — stage transition (state machine + KYC gate)
 * POST /v1/crm/onboarding-cases/:id/kyc   — record a KYC outcome
 *
 * There is no create route on purpose: a case exists because a deal was won, and the
 * deal-won consumer is the only thing that opens one.
 *
 * Every precondition the consumer's guarded UPDATE enforces is ALSO checked here
 * against the row the route already reads, because a 202 followed by a consumer that
 * silently drops the command tells the caller the operation succeeded when it did not.
 * The consumer keeps its guards regardless — the route's read is a snapshot and cannot
 * be trusted to still hold when the write lands.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { listQuery, windowOf, listEnvelope } from "../../shared/list-query.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import {
  ONBOARDING_STAGES,
  KYC_STATUSES,
  CANCELLATION_REASON_MIN_LENGTH,
  allowedNextKycStatuses,
  allowedNextStages,
  canKycTransition,
  canTransition,
  isKycStatus,
  isKycSatisfied,
  isOnboardingStage,
  isValidCancellationReason,
  requiresCancellationReason,
  requiresKycVerification,
} from "./domain.js";
import type { OnboardingCaseView } from "./schema.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
/** Signing off (or failing) a KYC check is an approval, not a sales action. */
const KYC_APPROVER_ROLES = ["crm_admin", "super_admin", "tenant_admin"];

const idParam = z.object({ id: z.string().uuid() });

const listCasesQuery = listQuery.extend({
  stage: z.enum(ONBOARDING_STAGES).optional(),
  accountId: z.string().uuid().optional(),
});

const stageBody = z.object({
  toStage: z.enum(ONBOARDING_STAGES),
  reason: z.string().max(2000).default(""),
  version: z.number().int().min(1).optional(),
});

const kycBody = z.object({
  status: z.enum(KYC_STATUSES),
  /** Opaque provider reference. Never a document number or any other identifier. */
  reference: z.string().min(1).max(120).optional(),
  version: z.number().int().min(1).optional(),
});

/** Load the case or 404. A case in another tenant is invisible, not forbidden. */
async function loadCase(tenantId: string, id: string): Promise<OnboardingCaseView> {
  const found = await queries.getOnboardingCase(id, tenantId);
  if (!found) throw new HttpError(404, "NOT_FOUND", "onboarding case not found");
  if (!isOnboardingStage(found.stage)) {
    throw new HttpError(422, "INVALID_STATE", `stored stage '${found.stage}' is not recognised`);
  }
  if (!isKycStatus(found.kycStatus)) {
    throw new HttpError(422, "INVALID_STATE", `stored KYC status '${found.kycStatus}' is not recognised`);
  }
  return found;
}

/**
 * The consumer's UPDATE is guarded on `version`, so a stale value there is a silent
 * no-op after a 202. Reject it while the caller can still see it.
 */
function assertVersion(expected: number | undefined, actual: number): void {
  if (expected !== undefined && expected !== actual) {
    throw new HttpError(409, "VERSION_CONFLICT", `onboarding case is at version ${actual}, not ${expected}`);
  }
}

export async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/crm/onboarding-cases", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const q = listCasesQuery.parse(req.query ?? {});
    const w = windowOf(q);
    const { rows, total } = await queries.listOnboardingCases(ctx.tenantId, w.pageSize, w.offset, {
      ...(q.stage ? { stage: q.stage } : {}),
      ...(q.accountId ? { accountId: q.accountId } : {}),
    });
    return reply.send(listEnvelope(rows, w, total));
  });

  app.get("/v1/crm/onboarding-cases/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(await loadCase(ctx.tenantId, id));
  });

  app.post("/v1/crm/onboarding-cases/:id/stage", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = stageBody.parse(req.body);
    const current = await loadCase(ctx.tenantId, id);
    const stage = current.stage as (typeof ONBOARDING_STAGES)[number];
    const kycStatus = current.kycStatus as (typeof KYC_STATUSES)[number];

    assertVersion(body.version, current.version);

    if (requiresCancellationReason(body.toStage) && !isValidCancellationReason(body.reason)) {
      throw new HttpError(
        400,
        "REASON_REQUIRED",
        `a reason of at least ${CANCELLATION_REASON_MIN_LENGTH} characters is required when cancelling an onboarding`,
      );
    }

    if (!canTransition(stage, body.toStage)) {
      const allowed = allowedNextStages(stage);
      throw new HttpError(
        422,
        "INVALID_TRANSITION",
        allowed.length === 0
          ? `'${stage}' is terminal; no further transitions are allowed`
          : `cannot move from '${stage}' to '${body.toStage}' (allowed: ${allowed.join(", ")})`,
      );
    }

    // THE KYC GATE. Checked here so a premature completion fails loudly at the caller,
    // and again in the consumer (and in a table CHECK) so it cannot be raced past.
    if (requiresKycVerification(body.toStage) && !isKycSatisfied(kycStatus)) {
      throw new HttpError(
        422,
        "KYC_NOT_VERIFIED",
        `onboarding cannot be completed while KYC is '${kycStatus}' — it must be 'verified'`,
      );
    }

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.advanceStage(ctx, id, {
        toStage: body.toStage,
        fromStage: stage,
        cancellationReason: body.toStage === "cancelled" ? body.reason.trim() : null,
        version: current.version,
      }),
    );
  });

  app.post("/v1/crm/onboarding-cases/:id/kyc", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const { id } = idParam.parse(req.params);
    const body = kycBody.parse(req.body);
    if (body.status === "verified" || body.status === "rejected") {
      requireRole(ctx, KYC_APPROVER_ROLES);
    }

    const current = await loadCase(ctx.tenantId, id);
    const kycStatus = current.kycStatus as (typeof KYC_STATUSES)[number];

    assertVersion(body.version, current.version);

    if (!canKycTransition(kycStatus, body.status)) {
      const allowed = allowedNextKycStatuses(kycStatus);
      throw new HttpError(
        422,
        "INVALID_KYC_TRANSITION",
        allowed.length === 0
          ? `KYC status '${kycStatus}' is final; no further changes are allowed`
          : `cannot move KYC from '${kycStatus}' to '${body.status}' (allowed: ${allowed.join(", ")})`,
      );
    }

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.recordKyc(ctx, id, {
        toStatus: body.status,
        fromStatus: kycStatus,
        reference: body.reference ?? null,
        version: current.version,
      }),
    );
  });
}
