import type { FastifyInstance } from "fastify";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as v from "./validators.js";
import * as commands from "./commands.js";
import {
  isValidNextStep, eMbFinalizationSequence, billFinalizationSequence, canCreateBill, canRecordMeasurement,
  billAmountExceedsAward, billAmountExceedsMeasuredValue, mbBelongsToBill, awardBelongsToWork,
  billedQuantityExceedsBoq, computeMeasuredValueMinor, boqItemBelongsToMbWork,
  finalizeStepRoles, isSelfFinalization, DEDUCTION_HEADS, computeDeductionLines,
} from "./domain.js";
import {
  getMb, getMbByNumber, getBill, listBillsForWork, listBills, countBills, listMeasurementsByMb, listMeasurementsByBoqItem,
  listBillsByMb, listMbsForWork, listAwardsForWork, listAccountCompilations, getEffectiveDeductionRates, listRecoveriesForBill,
} from "./repo.js";
import { getAwardById } from "../tender/repo.js";
import { getProposal } from "../proposal/repo.js";
import { getBoqItemById, listBoqItemsByIds } from "../boq/repo.js";
import { parseMinor } from "@civitasone/schemas";
import { paginationSchema } from "../masters/validators.js";

const WRITE_ROLES = ["works_admin", "works_operator", "super_admin", "dao", "do", "sdo", "section_officer", "estimator"];
// GAP-WORKS-BILLING-WORKID-03 (owner decision 2026-10-14): finalize roles are SO, SDO, estimator, auditor, DAO and
// DO, with works_admin and super_admin as override. works_operator may create/issue but holds no finalize step.
// The per-step check (finalizeStepRoles) then narrows each step. "auditor" gets no other write route.
const FINALIZE_ROLES = ["works_admin", "super_admin", "dao", "do", "sdo", "section_officer", "estimator", "auditor"];
// D4c #37: who may change the default statutory deduction rates of a division (the makers only read them).
const RATE_ADMIN_ROLES = ["works_admin", "super_admin", "dao", "do"];
const READ_ROLES = ["works_admin", "works_operator", "works_viewer", "super_admin", "dao", "do", "sdo", "section_officer", "estimator", "auditor"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A path id that reaches a uuid column must be a UUID: otherwise Postgres raises 22P02 and the caller sees a 500. */
function uuidParam(value: string, name: string): string {
  if (!UUID_RE.test(value)) throw new HttpError(400, "INVALID_ID", `${name} must be a UUID`);
  return value;
}

/**
 * GAP-WORKS-BILLING-WORKID-07: the per-work billing lists answer 404 for a work that does not exist instead of a
 * 200 with an empty array that is indistinguishable from "a real work with nothing billed yet".
 */
async function assertWorkExists(tenantId: string, workId: string): Promise<void> {
  if (!(await getProposal(tenantId, workId))) throw new HttpError(404, "NOT_FOUND", "work not found");
}

/**
 * The value of work measured against an MB and how much of it earlier bills have already consumed (all bigint minor
 * units). Single source for the create-bill ceiling check and the read-only position endpoint the bill form uses.
 */
async function mbBillingPosition(tenantId: string, mbId: string) {
  const mbMeasurements = await listMeasurementsByMb(tenantId, mbId);
  const boqItemIds = [...new Set(mbMeasurements.map((m) => m.boqItemId))];
  const boqItemRows = await listBoqItemsByIds(tenantId, boqItemIds);
  const rateByBoqItem = new Map(boqItemRows.map((b) => [b.id, b.rate]));
  const measuredValueMinor = computeMeasuredValueMinor(mbMeasurements, rateByBoqItem);
  const priorBillsAgainstMb = await listBillsByMb(tenantId, mbId);
  const priorBilledAgainstMb = priorBillsAgainstMb.reduce((sum, row) => sum + (row.grossAmountMinor ?? 0n), 0n);
  return { measuredValueMinor, priorBilledAgainstMb };
}

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  // GAP-WORKS-BILLING-BILLS-NEW-02: measured value / already billed / still billable for one MB, so the bill form
  // can show the ceiling and prefill the gross instead of leaving the clerk to guess a free-typed figure.
  app.get("/v1/works/billing/mb/:mbId/measured-value", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const mbId = uuidParam((req.params as { mbId: string }).mbId, "mbId");
    const mb = await getMb(ctx.tenantId, mbId);
    if (!mb) throw new HttpError(404, "NOT_FOUND", "measurement book not found");
    const { measuredValueMinor, priorBilledAgainstMb } = await mbBillingPosition(ctx.tenantId, mbId);
    const available = measuredValueMinor - priorBilledAgainstMb;
    return reply.send({
      data: {
        mbId,
        measuredValueMinor: measuredValueMinor.toString(),
        billedMinor: priorBilledAgainstMb.toString(),
        availableMinor: (available > 0n ? available : 0n).toString(),
      },
    });
  });

  // List bills for a work
  app.get("/v1/works/billing/:workId/bills", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const workId = uuidParam((req.params as { workId: string }).workId, "workId");
    await assertWorkExists(ctx.tenantId, workId);
    const data = await listBillsForWork(ctx.tenantId, workId);
    return reply.send({ data });
  });

  // GAP-WORKS-BILLING-WORKID-04: list measurement books for a work — lets the
  // FE render selectable MBs with their own single "advance one step" button
  // instead of asking a clerk to paste a full MB UUID.
  app.get("/v1/works/billing/:workId/mbs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const workId = uuidParam((req.params as { workId: string }).workId, "workId");
    await assertWorkExists(ctx.tenantId, workId);
    const data = await listMbsForWork(ctx.tenantId, workId);
    return reply.send({ data });
  });

  // GAP-WORKS-BILLING-BILLS-NEW-01 / NEW-MB-01: list awards for a work — backs
  // the award picker on the Generate Bill / Issue MB forms (the Tenders list
  // never carried an award id, so the UUID had to be pasted).
  app.get("/v1/works/billing/:workId/awards", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const workId = uuidParam((req.params as { workId: string }).workId, "workId");
    await assertWorkExists(ctx.tenantId, workId);
    const data = await listAwardsForWork(ctx.tenantId, workId);
    return reply.send({ data });
  });

  // Tenant-wide bills register (paginated) — the FE billing list page.
  app.get("/v1/works/billing/bills", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = paginationSchema.parse(req.query);
    const [rows, total] = await Promise.all([
      listBills(ctx.tenantId, query.page, query.pageSize),
      countBills(ctx.tenantId),
    ]);
    const data = rows.map((r) => ({
      ...r,
      grossAmountMinor: r.grossAmountMinor?.toString() ?? null,
      netPayableMinor: r.netPayableMinor?.toString() ?? null,
      deductionsMinor: r.deductionsMinor?.toString() ?? null,
    }));
    // GAP2-WORKS-APPROVALS-05: report the REAL tenant total (not data.length).
    return reply.send({ data, meta: { page: query.page, pageSize: query.pageSize, total } });
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

    // GAP-WORKS-BILLING-NEW-MB-03: duplicate MB number for this work → 409 so
    // the form can show a field-level message (the consumer re-checks).
    if (await getMbByNumber(ctx.tenantId, body.workId, body.mbNumber.trim())) {
      throw new HttpError(409, "DUPLICATE_MB_NUMBER", "MB number already used for this work");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.issueMbCommand(ctx, body));
  });

  // Finalize MB
  app.post("/v1/works/billing/mb/:id/finalize", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINALIZE_ROLES);
    const body = v.finalizeMbSchema.parse({ ...(req.body as object), id: (req.params as { id: string }).id });
    const mb = await getMb(ctx.tenantId, body.id);
    if (!mb) throw new HttpError(404, "NOT_FOUND", "measurement book not found");

    const seq = eMbFinalizationSequence();

    // GAP-WORKS-BILLING-WORKID-07: finalizing the step the MB is ALREADY at is a replay (double click, retry after a
    // timeout), not an error. It is answered 200 with the current state and publishes nothing, so no second event
    // or audit row is produced. The authority checks run first: a caller who could not take this step is refused
    // exactly as before, whatever the current state is.
    if (mb.status === body.nextStatus) {
      requireRole(ctx, finalizeStepRoles(body.nextStatus));
      if (isSelfFinalization(ctx.actorId, { createdBy: mb.createdBy, issuedBy: mb.issuedBy })) {
        throw new HttpError(422, "SELF_APPROVAL_FORBIDDEN", "The issuer of a measurement book cannot finalize it (maker-checker rule)");
      }
      return reply.send({ data: { id: mb.id, status: mb.status, alreadyApplied: true } });
    }
    if (!isValidNextStep(mb.status, body.nextStatus, seq)) {
      throw new HttpError(422, "INVALID_STEP", `Cannot transition from '${mb.status}' to '${body.nextStatus}'`);
    }

    // GAP-WORKS-BILLING-WORKID-03: per-step authority + maker-checker.
    requireRole(ctx, finalizeStepRoles(body.nextStatus));
    if (isSelfFinalization(ctx.actorId, { createdBy: mb.createdBy, issuedBy: mb.issuedBy })) {
      throw new HttpError(422, "SELF_APPROVAL_FORBIDDEN", "The issuer of a measurement book cannot finalize it (maker-checker rule)");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.finalizeMbCommand(ctx, body.id, body.nextStatus));
  });

  // Create bill
  app.post("/v1/works/billing/bills", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.createBillSchema.parse(req.body);

    // D4c #37: the statutory deduction lines ARE the bill's deductions. Refuse a figure that disagrees, or lines that
    // swallow more than the gross, before anything is queued (the consumer re-checks in its transaction).
    if (body.recoveries && body.recoveries.length > 0) {
      const linesTotal = body.recoveries.reduce((sum, r) => sum + parseMinor(r.amountMinor), 0n);
      if (body.deductionsMinor !== undefined && parseMinor(body.deductionsMinor) !== linesTotal) {
        throw new HttpError(422, "DEDUCTIONS_MISMATCH", "The deductions total does not equal the sum of the deduction lines");
      }
      if (linesTotal > parseMinor(body.grossAmountMinor)) {
        throw new HttpError(422, "DEDUCTIONS_EXCEED_GROSS", "The deduction lines add up to more than the bill gross amount");
      }
    }

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

    // measured value + prior bills against this MB (shared with GET .../mb/:mbId/measured-value)
    const { measuredValueMinor, priorBilledAgainstMb } = await mbBillingPosition(ctx.tenantId, body.mbId);

    // Code-review fix (double-billing gap): the measured-value ceiling is
    // per-MB and cumulative — prior bills already citing this SAME mbId
    // must be subtracted, or a second bill against an already-fully-billed
    // MB would recompute the identical measured value and pass again. This
    // route-level read is best-effort (see the locked, authoritative check
    // in billing/consumer.ts billCreate for the real guarantee under
    // concurrency).
    const newGross = parseMinor(body.grossAmountMinor);
    if (billAmountExceedsMeasuredValue(priorBilledAgainstMb, newGross, measuredValueMinor)) {
      throw new HttpError(
        422,
        "MEASURED_VALUE_EXCEEDED",
        `Bill gross amount (${newGross}) plus amount already billed against this MB (${priorBilledAgainstMb}) exceeds the value of work measured against it (${measuredValueMinor})`,
      );
    }

    const priorBills = await listBillsForWork(ctx.tenantId, body.workId);
    // A bill number is unique within a work (case-insensitive, like the MB number above). The consumer re-checks
    // inside its transaction, under a per-work lock, because this pre-check can race.
    const wantedNumber = body.billNumber.toLowerCase();
    if (priorBills.some((row) => (row.billNumber ?? "").trim().toLowerCase() === wantedNumber)) {
      throw new HttpError(409, "DUPLICATE_BILL_NUMBER", "Bill number already used for this work");
    }
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
    requireRole(ctx, FINALIZE_ROLES);
    const body = v.finalizeBillSchema.parse({ ...(req.body as object), id: (req.params as { id: string }).id });
    const bill = await getBill(ctx.tenantId, body.id);
    if (!bill) throw new HttpError(404, "NOT_FOUND", "bill not found");

    const seq = billFinalizationSequence();

    // GAP-WORKS-BILLING-WORKID-07: replay of a step the bill is already at -> 200, nothing published (see the MB
    // route above). This is what stops a double click on the DO step from raising a second finance hand-off.
    if (bill.status === body.nextStatus) {
      requireRole(ctx, finalizeStepRoles(body.nextStatus));
      if (isSelfFinalization(ctx.actorId, { createdBy: bill.createdBy })) {
        throw new HttpError(422, "SELF_APPROVAL_FORBIDDEN", "The creator of a bill cannot finalize it (maker-checker rule)");
      }
      return reply.send({ data: { id: bill.id, status: bill.status, alreadyApplied: true } });
    }
    if (!isValidNextStep(bill.status, body.nextStatus, seq)) {
      throw new HttpError(422, "INVALID_STEP", `Cannot transition from '${bill.status}' to '${body.nextStatus}'`);
    }

    // GAP-WORKS-BILLING-WORKID-03: per-step authority + maker-checker.
    requireRole(ctx, finalizeStepRoles(body.nextStatus));
    if (isSelfFinalization(ctx.actorId, { createdBy: bill.createdBy })) {
      throw new HttpError(422, "SELF_APPROVAL_FORBIDDEN", "The creator of a bill cannot finalize it (maker-checker rule)");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.finalizeBillCommand(ctx, body.id, body.nextStatus));
  });

  // List measurements recorded against an MB. (bug #3 follow-up: previously
  // there was no GET endpoint at all, so a caller had no way to discover
  // that a measurement write had been silently dropped by the consumer.)
  app.get("/v1/works/billing/mb/:mbId/measurements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const mbId = uuidParam((req.params as { mbId: string }).mbId, "mbId");
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
    if (!canRecordMeasurement(mb.status)) {
      throw new HttpError(
        409,
        "MB_NOT_OPEN",
        `Cannot record a measurement: measurement book status is '${mb.status}'; measurements can only be recorded while it is 'draft'`,
      );
    }

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

  // GAP-WORKS-BILLING-ACCOUNT-COMPILE-03: list prior compilations for a
  // month/year so the FE can warn before a duplicate treasury submission.
  app.get("/v1/works/billing/account-compile", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["dao", "do", "works_admin", "super_admin"]);
    const query = v.listAccountCompileSchema.parse(req.query);
    const data = await listAccountCompilations(ctx.tenantId, query.month, query.year);
    return reply.send({ data });
  });

  // D4c #37: default rate (basis points) of every fixed deduction head for a division, or the tenant-wide default.
  app.get("/v1/works/billing/deduction-rates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { divisionId } = v.deductionScopeQuerySchema.parse(req.query);
    const rates = await getEffectiveDeductionRates(ctx.tenantId, divisionId ?? null);
    return reply.send({ data: { divisionId: divisionId ?? null, rates: DEDUCTION_HEADS.map((head) => ({ head, rateBps: rates[head] })) } });
  });

  // D4c #37: set the default rates (per division, or tenant-wide when no division is sent). CQRS: 202 + consumer.
  app.put("/v1/works/billing/deduction-rates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, RATE_ADMIN_ROLES);
    const body = v.setDeductionRatesSchema.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.setDeductionRatesCommand(ctx, body));
  });

  // D4c #37: the amounts the maker starts from — each head computed from the gross at the work's division rate.
  app.get("/v1/works/billing/deduction-preview", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = v.deductionPreviewQuerySchema.parse(req.query);
    const proposal = await getProposal(ctx.tenantId, q.workId);
    if (!proposal) throw new HttpError(404, "NOT_FOUND", "work not found");
    const rates = await getEffectiveDeductionRates(ctx.tenantId, proposal.executingDivisionId ?? null);
    const lines = computeDeductionLines(parseMinor(q.grossAmountMinor), rates);
    return reply.send({
      data: {
        lines: lines.map((l) => ({ head: l.head, rateBps: l.rateBps, amountMinor: l.amountMinor.toString() })),
        totalMinor: lines.reduce((sum, l) => sum + l.amountMinor, 0n).toString(),
      },
    });
  });

  // D4c #37: the checker's view of a bill's deduction lines — what the maker charged beside what the rates computed.
  app.get("/v1/works/billing/bills/:id/recoveries", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const id = uuidParam((req.params as { id: string }).id, "id");
    if (!(await getBill(ctx.tenantId, id))) throw new HttpError(404, "NOT_FOUND", "bill not found");
    const rows = await listRecoveriesForBill(ctx.tenantId, id);
    return reply.send({
      data: rows.map((r) => ({
        id: r.id,
        recoveryType: r.recoveryType,
        amountMinor: r.amountMinor.toString(),
        computedAmountMinor: r.computedAmountMinor === null ? null : r.computedAmountMinor.toString(),
        rateBps: r.rateBps,
        adjusted: r.computedAmountMinor !== null && r.computedAmountMinor !== r.amountMinor,
        remarks: r.remarks,
      })),
    });
  });
}
