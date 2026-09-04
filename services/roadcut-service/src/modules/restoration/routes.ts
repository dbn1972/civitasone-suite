import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { zMoneyMinorStringNonNeg } from "@civitasone/schemas";
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
// a plain non-negative integer -- an unparseable value (e.g. "abc") would
// previously reach `BigInt(p.refundMinor)` unchecked in the consumer and
// throw, the same poison-pill shape found in the applications module.
//
// CODEC FIX: this used to be a hand-rolled `z.string().regex(/^\d+$/, ...)`
// duplicating exactly what @civitasone/schemas' money codec (R7) already
// centralises for every other money field crossing an HTTP/queue boundary
// fleet-wide. The hand-rolled version happened not to be an active
// corruption bug here -- the value is never round-tripped through a JS
// `number` on the way to the bigint column (confirmed by reading
// restoration/consumer.ts: `p.refundMinor ? BigInt(p.refundMinor) : 0n`,
// string straight to BigInt) -- but it's a real deviation from the
// canonical codec for no reason, and any future edit to this field's
// validation would silently miss whatever R7 gains next (e.g. the
// z.NEVER/ctx.addIssue safe-error handling money.ts documents). Swapping to
// zMoneyMinorStringNonNeg for fleet consistency; behaviourally equivalent
// for this field (both reject non-digit-string and negative input) since
// the field stays optional here regardless of codec.
const refundBody = z.object({
  decision: z.enum(["full_refund", "partial_refund", "forfeited"]),
  refundMinor: zMoneyMinorStringNonNeg.optional(),
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
    // Quality must agree with the decision at BOTH ends: a full refund only
    // makes sense for verified-satisfactory work, and forfeiting the deposit
    // only makes sense for verified-unsatisfactory work. Previously only the
    // full_refund half of this was checked — "forfeited" on a "satisfactory"
    // restoration fell into the same branch as full_refund below and got
    // calculateRefundMinor(deposit, quality), which paid out the FULL
    // deposit for a decision that means the opposite (live-confirmed by an
    // independent review before this fix).
    if (body.decision === "full_refund" && existing.quality !== "satisfactory") {
      throw new HttpError(
        422,
        "QUALITY_MISMATCH",
        `Cannot grant a full refund; restoration quality was assessed as '${existing.quality}'`,
      );
    }
    if (body.decision === "forfeited" && existing.quality !== "unsatisfactory") {
      throw new HttpError(
        422,
        "QUALITY_MISMATCH",
        `Cannot forfeit the deposit; restoration quality was assessed as '${existing.quality}'`,
      );
    }

    // Resolve the actual deposit collected (restoration -> permit ->
    // application) so the refund amount is bounded by, or derived from, real
    // money on record rather than trusting an arbitrary client-supplied
    // figure.
    const permit = await permitsRepo.findById(existing.permitId, ctx.tenantId);
    if (!permit) {
      throw new HttpError(409, "PERMIT_NOT_FOUND", "Restoration references a permit that no longer exists");
    }
    const application = await applicationsRepo.findById(permit.applicationId, ctx.tenantId);
    if (!application || application.depositMinor == null) {
      throw new HttpError(409, "DEPOSIT_UNKNOWN", "Cannot determine the original deposit amount for this restoration");
    }
    const depositMinor = application.depositMinor;

    // The amount is DERIVED from `decision`, never taken from the client,
    // except for partial_refund where an explicit admin-supplied figure is
    // the only way to express "some amount, not all or nothing". Previously
    // a client-supplied refundMinor was honoured for ANY decision as long as
    // it merely didn't exceed the deposit — so {decision:"full_refund",
    // refundMinor:"0"} or {decision:"forfeited", refundMinor:"<full
    // deposit>"} both passed that check while inverting the decision's real
    // meaning (independent review finding, confirmed deterministic — no
    // race required).
    let refundMinor: bigint;
    if (body.decision === "partial_refund") {
      if (body.refundMinor == null) {
        throw new HttpError(422, "REFUND_AMOUNT_REQUIRED", "refundMinor is required for a partial_refund decision");
      }
      refundMinor = BigInt(body.refundMinor);
      if (refundMinor <= 0n || refundMinor >= depositMinor) {
        throw new HttpError(
          422,
          "INVALID_PARTIAL_REFUND_AMOUNT",
          "A partial refund must be strictly between 0 and the full deposit — use 'forfeited' or 'full_refund' for those boundary cases",
        );
      }
    } else {
      if (body.refundMinor != null) {
        throw new HttpError(
          422,
          "REFUND_AMOUNT_NOT_APPLICABLE",
          `refundMinor is only accepted for partial_refund; the amount for '${body.decision}' is computed automatically`,
        );
      }
      refundMinor = calculateRefundMinor(depositMinor, body.decision);
    }

    return reply.code(202).send(
      await commands.decideDepositRefund(ctx, id, body.decision, refundMinor.toString()),
    );
  });
}
