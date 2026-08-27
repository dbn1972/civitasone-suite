import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";
import { calculateRefundMinor } from "./domain.js";
import * as permitsRepo from "../permits/repo.js";
import * as applicationsRepo from "../applications/repo.js";

const ADMIN_ROLES = ["roadcut_admin", "super_admin"];

const startBody = z.object({
  permitId: z.string().uuid(),
  startDate: z.string().date(),
});

const completeBody = z.object({
  quality: z.enum(["satisfactory", "unsatisfactory"]),
  endDate: z.string().date(),
});

// refundMinor is money (bigint minor units) supplied as a string. It must be
// a plain non-negative integer — an unparseable value (e.g. "abc") would
// previously reach `BigInt(p.refundMinor)` unchecked in the consumer and
// throw, the same poison-pill shape found in the applications module.
const refundBody = z.object({
  decision: z.enum(["full_refund", "partial_refund", "forfeited"]),
  refundMinor: z.string().regex(/^\d+$/, "must be a non-negative integer (minor units)").optional(),
});

const idParam = z.object({ id: z.string().uuid() });

export async function restorationRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/roadcut/restorations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = startBody.parse(req.body);

    // No FK exists on roadcut_restorations.permit_id — confirm the permit is
    // real, that its work is actually finished, and that restoration hasn't
    // already been started for it (mirrors the permit-issuance fix above).
    const permit = await permitsRepo.findById(body.permitId, ctx.tenantId);
    if (!permit) throw new HttpError(404, "PERMIT_NOT_FOUND", "Referenced permit not found");
    if (permit.status !== "completed") {
      throw new HttpError(
        422,
        "PERMIT_NOT_COMPLETED",
        `Cannot start restoration for permit in status '${permit.status}'; work must be 'completed' first`,
      );
    }
    const existingRestoration = await repo.findByPermit(body.permitId, ctx.tenantId);
    if (existingRestoration) {
      throw new HttpError(409, "RESTORATION_ALREADY_EXISTS", "A restoration record already exists for this permit");
    }

    return reply.code(202).send(await commands.startRestoration(ctx, body.permitId, body.startDate));
  });

  app.get("/v1/roadcut/restorations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const row = await repo.findById(id, ctx.tenantId);
    if (!row) throw new HttpError(404, "RESTORATION_NOT_FOUND", "Restoration record not found");
    return reply.send({ data: row });
  });

  app.post("/v1/roadcut/restorations/:id/complete", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = completeBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "RESTORATION_NOT_FOUND", "Restoration record not found");
    if (existing.quality !== "pending") {
      throw new HttpError(422, "ALREADY_COMPLETED", "Restoration already assessed");
    }
    return reply.code(202).send(await commands.completeRestoration(ctx, id, body.quality, body.endDate));
  });

  app.post("/v1/roadcut/restorations/:id/refund", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = refundBody.parse(req.body);
    const existing = await repo.findById(id, ctx.tenantId);
    if (!existing) throw new HttpError(404, "RESTORATION_NOT_FOUND", "Restoration record not found");
    if (existing.depositRefundStatus !== "held") {
      throw new HttpError(422, "ALREADY_DECIDED", "Deposit refund already decided");
    }
    // The deposit cannot be released before the restoration has actually
    // been verified — confirmed live: a "full_refund" decision previously
    // succeeded while quality was still "pending" (never inspected).
    if (existing.quality === "pending") {
      throw new HttpError(
        422,
        "RESTORATION_NOT_ASSESSED",
        "Restoration quality has not been assessed yet; complete the restoration inspection before deciding a refund",
      );
    }
    // A full refund only makes sense when the restoration was actually
    // verified as satisfactory — otherwise the decision and the assessed
    // quality contradict each other.
    if (body.decision === "full_refund" && existing.quality !== "satisfactory") {
      throw new HttpError(
        422,
        "QUALITY_MISMATCH",
        `Cannot grant a full refund; restoration quality was assessed as '${existing.quality}'`,
      );
    }

    // Resolve the actual deposit collected (restoration -> permit ->
    // application) so the refund amount is bounded by, or derived from, real
    // money on record rather than trusting an arbitrary client-supplied
    // figure. Previously refundMinor was accepted as free-form client input
    // with no relationship to the deposit at all, and silently defaulted to
    // 0 whenever the caller omitted it — including for "full_refund".
    const permit = await permitsRepo.findById(existing.permitId, ctx.tenantId);
    if (!permit) {
      throw new HttpError(409, "PERMIT_NOT_FOUND", "Restoration references a permit that no longer exists");
    }
    const application = await applicationsRepo.findById(permit.applicationId, ctx.tenantId);
    if (!application || application.depositMinor == null) {
      throw new HttpError(409, "DEPOSIT_UNKNOWN", "Cannot determine the original deposit amount for this restoration");
    }
    const depositMinor = application.depositMinor;

    let refundMinor: bigint;
    if (body.refundMinor != null) {
      refundMinor = BigInt(body.refundMinor);
      if (refundMinor > depositMinor) {
        throw new HttpError(422, "REFUND_EXCEEDS_DEPOSIT", "refundMinor cannot exceed the original deposit");
      }
    } else if (body.decision === "partial_refund") {
      throw new HttpError(422, "REFUND_AMOUNT_REQUIRED", "refundMinor is required for a partial_refund decision");
    } else {
      // full_refund (quality already confirmed satisfactory above) or
      // forfeited: derive the correct amount from the assessed quality
      // instead of leaving it unset.
      refundMinor = calculateRefundMinor(depositMinor, existing.quality);
    }

    return reply.code(202).send(
      await commands.decideDepositRefund(ctx, id, body.decision, refundMinor.toString()),
    );
  });
}
