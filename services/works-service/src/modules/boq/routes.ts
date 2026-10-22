import type { FastifyInstance } from "fastify";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as v from "./validators.js";
import * as commands from "./commands.js";
import {
  listBoqItems, getRecapitulation, listAllBoqItems, getBoqItemById, boqIndexSummary, listBoqLineRefs, boqWorkTotals,
} from "./repo.js";
import { canEnterBoq, canModifyBoq, recapitulationBreakdown, isDuplicateBoqLine } from "./domain.js";
import { hasFinalizedTsForWork } from "../approval/repo.js";
import { hasTenderForWork, hasPreTenderForWork } from "../tender/repo.js";
import { getProposal } from "../proposal/repo.js";
import { paginationSchema } from "../masters/validators.js";

/** BR-015 input: "tender details exist" for the work (checks both the
 * populated pre_tenders table and — future-proofing — tenders). */
async function hasTenderDetailsForWork(tenantId: string, workId: string): Promise<boolean> {
  return (await hasTenderForWork(tenantId, workId)) || (await hasPreTenderForWork(tenantId, workId));
}

const WRITE_ROLES = ["works_admin", "works_operator", "super_admin", "estimator", "sdo", "section_officer"];
const READ_ROLES = ["works_admin", "works_operator", "works_viewer", "super_admin", "dao", "do", "sdo", "section_officer", "estimator"];

export async function boqRoutes(app: FastifyInstance): Promise<void> {
  // Tenant-wide BoQ index (paginated) — the FE BoQ list page.
  app.get("/v1/works/boq", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const query = paginationSchema.parse(req.query);
    // GAP-WORKS-BOQ-02: the FE stat cards need the FULL-set count and amount
    // total, not the length of the page it fetched. meta.total is the exact
    // tenant-wide row count (so "Showing first N of total" is honest) and
    // meta.totalAmountMinor is the paise-exact sum of every line.
    const [data, summary] = await Promise.all([
      listAllBoqItems(ctx.tenantId, query.page, query.pageSize),
      boqIndexSummary(ctx.tenantId),
    ]);
    return reply.send({
      data,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: summary.total,
        totalAmountMinor: summary.totalAmountMinor,
      },
    });
  });

  // List BoQ items for a work
  //
  // Bug fix (works-deep-verify, MEDIUM/L1): this never checked that `workId`
  // refers to a real work — listBoqItems() just runs a WHERE that legitimately
  // (and silently) matches zero rows for ANY id, real or not. Confirmed live:
  // GET /v1/works/boq/<random-uuid> returned 200 {"data":[]}, identical to a
  // real work with no BoQ entered yet. Because the frontend
  // (apps/web/.../works/boq/[workId]/page.tsx) only calls notFound() when
  // BOTH the items call AND the recapitulation call report source:"error",
  // and the items call never failed, /works/boq/<bogus-id> rendered a normal
  // "Bill of Quantities" page instead of 404ing — the exact "detail routes
  // 404 cleanly for a bogus id" failure mode this pass targets. Every other
  // :id/:workId detail route in this service (contractor, masters, proposal)
  // already validates existence and 404s; this brings boq in line with that
  // convention instead of pushing the check into the frontend.
  app.get("/v1/works/boq/:workId", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { workId } = v.workIdParamSchema.parse(req.params);
    const work = await getProposal(ctx.tenantId, workId);
    if (!work) throw new HttpError(404, "NOT_FOUND", "work not found");
    const data = await listBoqItems(ctx.tenantId, workId);
    return reply.send({ data });
  });

  // Get recapitulation for a work
  app.get("/v1/works/boq/:workId/recapitulation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { workId } = v.workIdParamSchema.parse(req.params);
    // GAP-WORKS-BOQ-WORKID-05: tell "no such work" apart from "this work has no recapitulation yet". Both are 404s
    // (the page treats a missing recap as "not computed"), but they carry different codes so a caller can act on it.
    if (!(await getProposal(ctx.tenantId, workId))) throw new HttpError(404, "NOT_FOUND", "work not found");
    const data = await getRecapitulation(ctx.tenantId, workId);
    if (!data) throw new HttpError(404, "RECAPITULATION_NOT_COMPUTED", "recapitulation has not been computed for this work");
    // GAP-WORKS-BOQ-WORKID-01: return a per-component breakdown (component,
    // basis, rate %, paise amount) alongside the stored row so the FE can show
    // a reviewer HOW the Grand Total is derived — rather than printing bare
    // percentages next to flat ₹ figures with no basis. Derived with the exact
    // bigint formula the recapitulate command persisted, so the line amounts
    // sum back to the stored grandTotal.
    const { lines, grandTotal } = recapitulationBreakdown(BigInt(data.workAmount), {
      contingencyPercent: Number(data.contingencyPercent),
      turnoverTaxPercent: Number(data.turnoverTaxPercent),
      workChargePercent: Number(data.workChargePercent),
      qualityControlPercent: Number(data.qualityControlPercent),
      centagePercent: Number(data.centagePercent),
      otherCharges: BigInt(data.otherCharges),
    });
    return reply.send({
      data: {
        ...data,
        breakdown: lines.map((l) => ({
          key: l.key,
          label: l.label,
          basis: l.basis,
          ratePercent: l.ratePercent,
          amountMinor: l.amountMinor.toString(),
        })),
        computedGrandTotal: grandTotal.toString(),
      },
    });
  });

  // Add BoQ item
  app.post("/v1/works/boq", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.addBoqItemSchema.parse(req.body);

    // BR-013: BoQ entry requires a finalized technical sanction (TS) to exist.
    const tsExists = await hasFinalizedTsForWork(ctx.tenantId, body.workId);
    if (!canEnterBoq(tsExists)) {
      throw new HttpError(422, "TS_REQUIRED", "BoQ entry requires a finalized technical sanction (TS) for this work");
    }

    // BR-015 applies to ADDING a line as much as to editing or deleting one: once tender details exist the BoQ is
    // frozen. (The consumer re-checks inside its transaction.)
    if (!canModifyBoq(await hasTenderDetailsForWork(ctx.tenantId, body.workId))) {
      throw new HttpError(409, "BOQ_FROZEN", "BoQ cannot be modified once tender details exist for this work");
    }

    // BR-016, answered synchronously: the duplicate used to be detected only in the async consumer, after the 202
    // had already been returned, so the clerk was told the line was accepted and it then silently never appeared.
    const existingLines = await listBoqLineRefs(ctx.tenantId, body.workId);
    if (isDuplicateBoqLine(existingLines, body.workId, body.itemCode, body.itemDescription)) {
      throw new HttpError(409, "DUPLICATE_BOQ_LINE", "A BoQ line with the same item code or description already exists for this work");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.addBoqItemCommand(ctx, body));
  });

  // Recapitulate
  app.post("/v1/works/boq/recapitulate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.recapitulateSchema.parse(req.body);

    // GAP-WORKS-BOQ-WORKID-05: the work amount is the sum of the work's stored BoQ lines (the consumer reads it again
    // under its own transaction); the client never supplies it. A work with no lines has nothing to recapitulate.
    if (!(await getProposal(ctx.tenantId, body.workId))) throw new HttpError(404, "NOT_FOUND", "work not found");
    // A work has ONE recapitulation. Whether a changed BoQ may replace it is a product decision that has not been made,
    // so a second request is refused rather than appended (appending left two Grand Totals and the read returned an
    // arbitrary one). The consumer re-checks under a per-work lock.
    if (await getRecapitulation(ctx.tenantId, body.workId)) {
      throw new HttpError(409, "RECAP_EXISTS", "A recapitulation has already been computed for this work");
    }
    const { lines } = await boqWorkTotals(ctx.tenantId, body.workId);
    if (lines === 0) {
      throw new HttpError(422, "BOQ_EMPTY", "Add BoQ items to this work before computing the recapitulation");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.recapitulateCommand(ctx, body));
  });

  // Update BoQ item
  app.patch("/v1/works/boq/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.updateBoqItemSchema.parse({ ...(req.body as object), id: v.idParamSchema.parse(req.params).id });

    // BR-015: BoQ cannot be modified once tender details exist for the work.
    const existing = await getBoqItemById(ctx.tenantId, body.id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "BoQ item not found");
    if (!canModifyBoq(await hasTenderDetailsForWork(ctx.tenantId, existing.workId))) {
      throw new HttpError(409, "BOQ_FROZEN", "BoQ cannot be modified once tender details exist for this work");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.updateBoqItemCommand(ctx, body));
  });

  // Delete BoQ item
  app.delete("/v1/works/boq/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = v.deleteBoqItemSchema.parse({ id: v.idParamSchema.parse(req.params).id });

    // BR-015: BoQ cannot be modified (including deleted) once tender
    // details exist for the work.
    const existing = await getBoqItemById(ctx.tenantId, body.id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "BoQ item not found");
    if (!canModifyBoq(await hasTenderDetailsForWork(ctx.tenantId, existing.workId))) {
      throw new HttpError(409, "BOQ_FROZEN", "BoQ cannot be modified once tender details exist for this work");
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.deleteBoqItemCommand(ctx, body.id));
  });
}
