import type { FastifyInstance } from "fastify";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as v from "./validators.js";
import * as commands from "./commands.js";
import {
  isValidNextStep, eMbFinalizationSequence, billFinalizationSequence, canCreateBill,
  billAmountExceedsAward, billAmountExceedsMeasuredValue, mbBelongsToBill, awardBelongsToWork,
  billedQuantityExceedsBoq, computeMeasuredValueMinor, boqItemBelongsToMbWork,
} from "./domain.js";
import {
  getMb, getBill, listBillsForWork, listBills, listMeasurementsByMb, listMeasurementsByBoqItem,
  listBillsByMb,
} from "./repo.js";
import { getAwardById } from "../tender/repo.js";
import { getBoqItemById, listBoqItemsByIds } from "../boq/repo.js";
import { parseMinor } from "@civitasone/schemas";
import { paginationSchema } from "../masters/validators.js";

const WRITE_ROLES = ["works_admin", "works_operator", "super_admin", "dao", "do", "sdo", "section_officer", "estimator"];
const READ_ROLES = ["works_admin", "works_operator", "works_viewer", "super_admin", "dao", "do", "sdo", "section_officer", "estimator"];

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  // List bills for a work
  app.get("/v1/works/billing/:workId/bills", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { workId } = req.params as { workId: string };
    const data = await listBillsForWork(ctx.tenantId, workId);
    return reply.send({ data });
  });

  // Tenant-wide bills register (paginated) — the FE billing list page.
  app.get("/v1/works/billing/bills", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = paginationSchema.parse(req.query);
    const rows = await listBills(ctx.tenantId, query.page, query.pageSize);
    const data = rows.map((r) => ({
      ...r,
      grossAmountMinor: r.grossAmountMinor?.toString() ?? null,
      netPayableMinor: r.netPayableMinor?.toString() ?? null,
      deductionsMinor: r.deductionsMinor?.toString() ?? null,
    }));
    return reply.send({ data, meta: { page: query.page, pageSize: query.pageSize, total: data.length } });
  });

  // Issue MB
  app.post("/v1/works/billing/mb", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.issueMbSchema.parse(req.body);

    // Same family as the bug #2 award/work check on bill create: an MB must
    // be issued against an award that actually belongs to the work.
    const award = await getAwardById(ctx.tenantId, body.awardId);
    if (!award) throw new HttpError(404, "NOT_FOUND", "award not found");
    if (!awardBelongsToWork(award, body.workId)) {
      throw new HttpError(422, "AWARD_WORK_MISMATCH", "The cited award does not belong to this work");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.issueMbCommand(ctx, body));
  });

  // Finalize MB
  app.post("/v1/works/billing/mb/:id/finalize", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.finalizeMbSchema.parse({ ...(req.body as object), id: (req.params as { id: string }).id });
    const mb = await getMb(ctx.tenantId, body.id);
    if (!mb) throw new HttpError(404, "NOT_FOUND", "measurement book not found");

    const seq = eMbFinalizationSequence();
    if (!isValidNextStep(mb.status, body.nextStatus, seq)) {
      throw new HttpError(422, "INVALID_STEP", `Cannot transition from '${mb.status}' to '${body.nextStatus}'`);
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.finalizeMbCommand(ctx, body.id, body.nextStatus));
  });

  // Create bill
  app.post("/v1/works/billing/bills", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.createBillSchema.parse(req.body);

    const award = await getAwardById(ctx.tenantId, body.awardId);
    if (!award) throw new HttpError(404, "NOT_FOUND", "award not found");
    // Bug #2: the cited award must actually belong to the work being billed
    // — otherwise the award-ceiling check below can be defeated by citing an
    // unrelated work's award that happens to have ceiling room left.
    if (!awardBelongsToWork(award, body.workId)) {
      throw new HttpError(422, "AWARD_WORK_MISMATCH", "The cited award does not belong to this work");
    }

    // No-3-way-match gate (bug #1): a bill must be backed by real measured
    // work — the referenced MB must belong to this work/award, be fully
    // finalized, and the bill's gross amount must not exceed the value of
    // work actually measured against it. Enforced here (pre-enqueue) AND
    // defensively in the consumer — see billing/consumer.ts billCreate.
    const mb = await getMb(ctx.tenantId, body.mbId);
    if (!mb) throw new HttpError(404, "NOT_FOUND", "measurement book not found");
    if (!canCreateBill(mb.status)) {
      throw new HttpError(
        409,
        "MB_NOT_ELIGIBLE",
        `Cannot create bill: measurement book status is '${mb.status}', must be 'do_finalized'`,
      );
    }
    if (!mbBelongsToBill(mb, body.workId, body.awardId)) {
      throw new HttpError(
        422,
        "MB_WORK_MISMATCH",
        "The referenced measurement book does not belong to this work/award",
      );
    }

    const mbMeasurements = await listMeasurementsByMb(ctx.tenantId, body.mbId);
    const boqItemIds = [...new Set(mbMeasurements.map((m) => m.boqItemId))];
    const boqItemRows = await listBoqItemsByIds(ctx.tenantId, boqItemIds);
    const rateByBoqItem = new Map(boqItemRows.map((b) => [b.id, b.rate]));
    const measuredValueMinor = computeMeasuredValueMinor(mbMeasurements, rateByBoqItem);

    // Code-review fix (double-billing gap): the measured-value ceiling is
    // per-MB and cumulative — prior bills already citing this SAME mbId
    // must be subtracted, or a second bill against an already-fully-billed
    // MB would recompute the identical measured value and pass again. This
    // route-level read is best-effort (see the locked, authoritative check
    // in billing/consumer.ts billCreate for the real guarantee under
    // concurrency).
    const priorBillsAgainstMb = await listBillsByMb(ctx.tenantId, body.mbId);
    const priorBilledAgainstMb = priorBillsAgainstMb.reduce(
      (sum, row) => sum + (row.grossAmountMinor ?? 0n),
      0n,
    );

    const newGross = parseMinor(body.grossAmountMinor);
    if (billAmountExceedsMeasuredValue(priorBilledAgainstMb, newGross, measuredValueMinor)) {
      throw new HttpError(
        422,
        "MEASURED_VALUE_EXCEEDED",
        `Bill gross amount (${newGross}) plus amount already billed against this MB (${priorBilledAgainstMb}) exceeds the value of work measured against it (${measuredValueMinor})`,
      );
    }

    const priorBills = await listBillsForWork(ctx.tenantId, body.workId);
    const priorBilledGross = priorBills.reduce(
      (sum, row) => sum + (row.grossAmountMinor ?? 0n),
      0n,
    );
    if (billAmountExceedsAward(priorBilledGross, newGross, award.acceptedAmountMinor)) {
      throw new HttpError(
        422,
        "AWARD_CEILING_EXCEEDED",
        "Cumulative bill gross amount exceeds accepted award ceiling",
      );
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.createBillCommand(ctx, body));
  });

  // Finalize bill
  app.post("/v1/works/billing/bills/:id/finalize", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.finalizeBillSchema.parse({ ...(req.body as object), id: (req.params as { id: string }).id });
    const bill = await getBill(ctx.tenantId, body.id);
    if (!bill) throw new HttpError(404, "NOT_FOUND", "bill not found");

    const seq = billFinalizationSequence();
    if (!isValidNextStep(bill.status, body.nextStatus, seq)) {
      throw new HttpError(422, "INVALID_STEP", `Cannot transition from '${bill.status}' to '${body.nextStatus}'`);
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.finalizeBillCommand(ctx, body.id, body.nextStatus));
  });

  // List measurements recorded against an MB. (bug #3 follow-up: previously
  // there was no GET endpoint at all, so a caller had no way to discover
  // that a measurement write had been silently dropped by the consumer.)
  app.get("/v1/works/billing/mb/:mbId/measurements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { mbId } = req.params as { mbId: string };
    const data = await listMeasurementsByMb(ctx.tenantId, mbId);
    return reply.send({ data });
  });

  // Record a measurement against an MB
  app.post("/v1/works/billing/measurements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.recordMeasurementSchema.parse(req.body);

    const mb = await getMb(ctx.tenantId, body.mbId);
    if (!mb) throw new HttpError(404, "NOT_FOUND", "measurement book not found");

    // FR-BIL-011 gate (bug #3): the cumulative-vs-BoQ-approved-quantity
    // ceiling was previously enforced only inside the async consumer, so
    // the route always returned 202 even when the write would be silently
    // dropped. Enforce it synchronously here too — the consumer keeps its
    // own check as defense in depth.
    const boqItem = await getBoqItemById(ctx.tenantId, body.boqItemId);
    if (!boqItem) throw new HttpError(404, "NOT_FOUND", "BoQ item not found");

    // Bug fix (works-cross-entity-integrity #1, CRITICAL): the cited BoQ item
    // must belong to the same work as the MB it's being recorded against —
    // otherwise the "measured value" ceiling a bill is later checked against
    // (see billing/domain.ts computeMeasuredValueMinor /
    // billAmountExceedsMeasuredValue) can be computed from a completely
    // unrelated work's BoQ item/rate, defeating the no-3-way-match fix.
    // Enforced here (pre-enqueue) AND defensively in the consumer — see
    // billing/consumer.ts measurementRecord.
    if (!boqItemBelongsToMbWork(boqItem, mb)) {
      throw new HttpError(422, "BOQ_WORK_MISMATCH", "The cited BoQ item does not belong to this MB's work");
    }

    const priorMeasurements = await listMeasurementsByBoqItem(ctx.tenantId, body.boqItemId);
    const priorBilled = priorMeasurements.reduce((sum, r) => sum + Number(r.quantity ?? 0), 0);
    const cumulative = priorBilled + body.quantity;
    if (billedQuantityExceedsBoq(cumulative, Number(boqItem.quantity))) {
      throw new HttpError(
        422,
        "BOQ_QUANTITY_EXCEEDED",
        `Cumulative measurement (${cumulative}) would exceed approved BoQ quantity (${boqItem.quantity})`,
      );
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.recordMeasurementCommand(ctx, body));
  });

  // Compile monthly account
  app.post("/v1/works/billing/account-compile", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["dao", "do", "works_admin", "super_admin"]);
    const body = v.compileAccountSchema.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.compileAccountCommand(ctx, body));
  });
}
