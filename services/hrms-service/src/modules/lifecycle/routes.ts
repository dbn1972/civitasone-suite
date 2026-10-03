import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { batchEmployees, batchDepartments, batchDesignations } from "../../shared/batch-resolve.js";
import { hrmsPromotions, hrmsTransfers } from "./schema.js";
import { createTransferBody, createPromotionBody, issueOrderBody, relieveBody, joinBody, idParam, checklistToggleBody, TOTAL_CHECKLIST_ITEMS } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
// GAP-HR-RETIREMENT-01: decision packet's recommendation is explicitly
// "gated to HR admin" for issuing a PPO (a statutory, irreversible pension
// action) -- narrower than HR_ROLES above, which also admits hr_officer.
const HR_ADMIN_ROLES = ["hr_admin", "super_admin"];

export async function lifecycleRoutes(app: FastifyInstance): Promise<void> {
  // GAP-HR-SF-17: this list previously returned raw employeeId/fromDesigId/
  // toDesigId with no resolved name, forcing the web layer to either show a
  // raw UUID or make N+1 follow-up calls. Adds employeeName/from-toDesignationName
  // alongside the existing raw fields (kept unchanged, still needed for actions)
  // via the shared batch-resolution helper — same shape as the already-correct
  // lifecycle/m7-list-routes.ts pattern, but resolved through employee/repo.ts's
  // in-process interface rather than importing employee/schema.js directly
  // (CLAUDE.md rule 4: module isolation).
  //
  // GAP-HR-DPC-02: also resolves each row's `department` (the employee's own
  // department, via the same batchEmployees lookup already needed for the
  // name — hrms_promotions itself carries no department column) — the DPC
  // page's PromotionCard already had an optional `department` field it
  // rendered when present, just never received. Also accepts an optional
  // `?status=` filter so a caller (the DPC batch view) can scope to
  // still-in-flight promotions instead of the whole tenant's history; there
  // is no DPC-batch id in this schema to scope more precisely than that
  // (see this GAP's own note on the missing dpcDate/batch linkage).
  app.get("/v1/hrms/lifecycle/promotions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    // GAP-HR-EMPLOYEES-DETAIL-04 / re-opened GAP-HR-EMPLOYEES-DETAIL-01
    // (SF-16): PR #1651 fixed this exact "?employeeId= silently ignored"
    // leak, but in lifecycle/m7-list-routes.ts's un-prefixed GET
    // /v1/hrms/promotions -- a DIFFERENT route from this one. This route
    // (GET /v1/hrms/lifecycle/promotions) is the one employees/[id]/
    // page.tsx's getLifecycleEvents() actually calls, and it never got the
    // same fix: every profile showed the WHOLE tenant's promotion history
    // (grades/postings of every employee) to any HR-role viewer. GAP-HR-SF-17
    // (#1658), merged after #1651 off an older base, re-added this exact
    // route's body from a pre-#1651 copy without the filter -- same bug,
    // back from a different commit. Mirrors #1651's m7-list-routes.ts
    // pattern exactly, folded in with SF-17's batch name-resolution.
    const q = z.object({
      employeeId: z.string().uuid().optional(),
      status: z.string().max(24).optional(),
    }).parse(req.query);
    const conditions = [eq(hrmsPromotions.tenantId, ctx.tenantId)];
    if (q.employeeId) conditions.push(eq(hrmsPromotions.employeeId, q.employeeId));
    if (q.status) conditions.push(eq(hrmsPromotions.status, q.status));
    const rows = await scopedRead((tx) => tx.select().from(hrmsPromotions)
      .where(and(...conditions))
      .orderBy(desc(hrmsPromotions.effectiveDate)));
    if (rows.length === 0) return reply.send({ data: [] });
    const empMap = await batchEmployees(ctx.tenantId, rows.map((r) => r.employeeId));
    const desigMap = await batchDesignations(ctx.tenantId, [
      ...rows.map((r) => r.fromDesigId),
      ...rows.map((r) => r.toDesigId),
    ]);
    const deptMap = await batchDepartments(ctx.tenantId, rows.map((r) => empMap.get(r.employeeId)?.departmentId));
    const data = rows.map((r) => ({
      ...r,
      employeeName: empMap.get(r.employeeId)?.fullName ?? "—",
      department: deptMap.get(empMap.get(r.employeeId)?.departmentId ?? "") ?? "—",
      fromDesignationName: desigMap.get(r.fromDesigId) ?? "—",
      toDesignationName: desigMap.get(r.toDesigId) ?? "—",
      // GAP-HR-PROMOTION-01/06: `...r` above still carries the raw
      // hrms_promotions row, including newBasicMinor as a plain JS bigint
      // (lifecycle/schema.ts: bigint({mode:"bigint"})). JSON has no bigint
      // type and this repo has no global BigInt serializer (confirmed: grep
      // for "BigInt.prototype.toJSON" across services/hrms-service/src and
      // packages finds none) -- reply.send(payload) would throw
      // "TypeError: Do not know how to serialize a BigInt" for every
      // promotion row that actually recorded a new basic pay, which is the
      // core data this page exists to show. Overriding it here (after the
      // spread, so this wins) to the same string-or-null shape formatMoney
      // and the web PromotionRow type already expect.
      newBasicMinor: r.newBasicMinor != null ? r.newBasicMinor.toString() : null,
    }));
    return reply.send({ data });
  });

  app.post("/v1/hrms/lifecycle/promotions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createPromotionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createPromotion(ctx, body as unknown as Record<string, unknown>));
  });

  // GAP-HR-SF-17: same enrichment as promotions above — employeeName plus
  // from/toDepartmentName resolved alongside the existing raw ids and the
  // free-text fromStation/toStation (kept as-is; station and department are
  // distinct concepts in this schema, so both are surfaced rather than one
  // silently standing in for the other).
  app.get("/v1/hrms/lifecycle/transfers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    // GAP-HR-EMPLOYEES-DETAIL-04 / re-opened GAP-HR-EMPLOYEES-DETAIL-01 --
    // see the identical comment on GET /v1/hrms/lifecycle/promotions above.
    const q = z.object({ employeeId: z.string().uuid().optional() }).parse(req.query);
    const rows = await scopedRead((tx) => tx.select().from(hrmsTransfers)
      .where(
        q.employeeId
          ? and(eq(hrmsTransfers.tenantId, ctx.tenantId), eq(hrmsTransfers.employeeId, q.employeeId))
          : eq(hrmsTransfers.tenantId, ctx.tenantId),
      )
      .orderBy(desc(hrmsTransfers.effectiveDate)));
    if (rows.length === 0) return reply.send({ data: [] });
    const empMap = await batchEmployees(ctx.tenantId, rows.map((r) => r.employeeId));
    const deptMap = await batchDepartments(ctx.tenantId, [
      ...rows.map((r) => r.fromDeptId),
      ...rows.map((r) => r.toDeptId),
    ]);
    const data = rows.map((r) => ({
      ...r,
      employeeName: empMap.get(r.employeeId)?.fullName ?? "—",
      fromDepartmentName: deptMap.get(r.fromDeptId) ?? "—",
      toDepartmentName: deptMap.get(r.toDeptId) ?? "—",
    }));
    return reply.send({ data });
  });

  app.post("/v1/hrms/lifecycle/transfers", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createTransferBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createTransfer(ctx, body as unknown as Record<string, unknown>));
  });

  app.post("/v1/hrms/lifecycle/transfers/:id/issue-order", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = issueOrderBody.parse(req.body);
    // GAP-HR-TRANSFER-02: the order number/date are typed by the issuing officer
    // (the department's order register), so validate them here, before the 202.
    //  - the order date cannot be in the future (IST calendar date);
    //  - the transfer must still be awaiting an order (mirrors the relieve route);
    //  - the order number must be unique within the tenant (case-insensitive).
    const todayIst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    if (body.orderDate > todayIst) {
      throw new HttpError(422, "ORDER_DATE_IN_FUTURE", "the order date cannot be in the future");
    }
    const existing = await scopedRead((tx) => tx.select().from(hrmsTransfers)
      .where(and(eq(hrmsTransfers.id, id), eq(hrmsTransfers.tenantId, ctx.tenantId))).limit(1));
    const transfer = existing[0];
    if (!transfer) throw new HttpError(404, "NOT_FOUND", "transfer not found");
    if (transfer.status !== "requested" && transfer.status !== "pending") {
      throw new HttpError(409, "INVALID_STATE", `an order can only be issued for a 'requested' transfer (currently '${transfer.status}')`);
    }
    if (await repo.findTransferByOrderNo(ctx.tenantId, body.orderNo, id)) {
      throw new HttpError(409, "ORDER_NO_EXISTS", `order number '${body.orderNo}' is already used by another transfer order`);
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.issueTransferOrder(ctx, id, body as unknown as Record<string, unknown>));
  });

  app.post("/v1/hrms/lifecycle/transfers/:id/relieve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = relieveBody.parse(req.body);

    // Synchronous pre-check: the async consumer's transitionTransfer already
    // guards this (from: ["ordered"]), but only AFTER the route has replied
    // 202 (fire-and-forget publish) -- so relieving before the order was
    // issued was told "accepted" while the write silently no-op'd in the
    // consumer (0 rows matched `from`), leaving the transfer's real status
    // untouched with no visible error. Mirror the same read-then-guard
    // pattern used by rti/routes.ts and lifecycle/hold-routes.ts, before
    // publish, rather than relying on the consumer's guard alone.
    const existing = await scopedRead((tx) => tx.select().from(hrmsTransfers)
      .where(and(eq(hrmsTransfers.id, id), eq(hrmsTransfers.tenantId, ctx.tenantId)))
      .limit(1));
    const transfer = existing[0];
    if (!transfer) throw new HttpError(404, "NOT_FOUND", "transfer not found");
    if (transfer.status !== "ordered") {
      throw new HttpError(409, "INVALID_STATE", `transfer must be 'ordered' to relieve (currently '${transfer.status}')`);
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.relieveTransfer(ctx, id, body as unknown as Record<string, unknown>));
  });

  app.post("/v1/hrms/lifecycle/transfers/:id/join", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = joinBody.parse(req.body);

    // Synchronous pre-check — same fake-success gap as relieve above, mirrored
    // against the consumer's join guard (from: ["relieved"]). Without this, a
    // double-join (joined -> joined) was told "accepted" while the second
    // write silently no-op'd.
    const existing = await scopedRead((tx) => tx.select().from(hrmsTransfers)
      .where(and(eq(hrmsTransfers.id, id), eq(hrmsTransfers.tenantId, ctx.tenantId)))
      .limit(1));
    const transfer = existing[0];
    if (!transfer) throw new HttpError(404, "NOT_FOUND", "transfer not found");
    if (transfer.status !== "relieved") {
      throw new HttpError(409, "INVALID_STATE", `transfer must be 'relieved' to join (currently '${transfer.status}')`);
    }

    return sendAccepted(reply, acceptedResponseSchema, await commands.joinTransfer(ctx, id, body as unknown as Record<string, unknown>));
  });

  // GAP-HR-RETIREMENT-01 ---------------------------------------------------
  app.get("/v1/hrms/separations/:id/checklist", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    // GAP-HR-RETIREMENT-01: reads outside an existing transaction must go
    // through scopedRead -- the tenant-isolation GUC is only set for the
    // lifetime of that transaction (see this file's own relieve/join
    // handlers above); a bare repo.getX(...) call (defaulting to plain
    // `db`) silently returns zero rows under RLS instead of erroring.
    const [separation, rows] = await scopedRead(async (tx) => [
      await repo.getSeparation(ctx.tenantId, id, tx),
      await repo.getChecklistRows(ctx.tenantId, id, tx),
    ]);
    if (!separation) throw new HttpError(404, "NOT_FOUND", "separation not found");
    return reply.send({
      data: rows.map((r) => ({ stepId: r.stepId, checkIndex: r.checkIndex, done: r.done, doneBy: r.doneBy, doneAt: r.doneAt })),
      ppoIssuedAt: separation.ppoIssuedAt,
      ppoIssuedBy: separation.ppoIssuedBy,
    });
  });

  app.put("/v1/hrms/separations/:id/checklist", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = checklistToggleBody.parse(req.body);
    const separation = await scopedRead((tx) => repo.getSeparation(ctx.tenantId, id, tx));
    if (!separation) throw new HttpError(404, "NOT_FOUND", "separation not found");
    // A PPO already issued makes the checklist an immutable historical
    // record -- same "irreversible once issued" rule as the action itself.
    if (separation.ppoIssuedAt) {
      throw new HttpError(409, "PPO_ALREADY_ISSUED", "PPO has already been issued; the checklist is now read-only");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.toggleChecklistItem(ctx, id, body));
  });

  app.post("/v1/hrms/separations/:id/issue-ppo", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const [separation, complete] = await scopedRead(async (tx) => [
      await repo.getSeparation(ctx.tenantId, id, tx),
      await repo.isChecklistComplete(ctx.tenantId, id, tx),
    ]);
    if (!separation) throw new HttpError(404, "NOT_FOUND", "separation not found");
    if (separation.ppoIssuedAt) {
      throw new HttpError(409, "PPO_ALREADY_ISSUED", "PPO has already been issued for this separation");
    }
    // Synchronous pre-check (same pattern as transfers' relieve/join above):
    // refuse before publishing, not just inside the async consumer, so the
    // caller never gets a fake-success 202 for an incomplete checklist.
    if (!complete) {
      throw new HttpError(409, "CHECKLIST_INCOMPLETE", `all ${TOTAL_CHECKLIST_ITEMS} checklist items must be done before a PPO can be issued`);
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.issuePpo(ctx, id));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
