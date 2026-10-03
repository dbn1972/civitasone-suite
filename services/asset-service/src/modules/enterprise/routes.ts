import { randomUUID } from "node:crypto";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { publishF3Write } from "../../shared/f3-publish.js";
import * as repo from "./repo.js";
import * as registerRepo from "../register/repo.js";
import { makeBarcode } from "../register/consumer.js";
import { uuidV5 } from "../../shared/ids.js";
import { bulkImportBody, duplicateCodes, summariseCodes, parseIdempotencyKey } from "./bulk-import.js";
import { isRealDateNotAfterToday, todayIST } from "../../shared/dates.js";
import { buildLeaseSchedule, type LeaseFrequency } from "./lease-domain.js";
import { requireGlHeads, reasonMessage, assertDistinctHeads, headsFromSettings, ALL_HEAD_KINDS, accountingStatus } from "./gl-heads.js";
import { validateHead, type HeadKind } from "../../shared/finance-client.js";
import { SWEEP_LIMIT } from "./postings.js";

const ASSET_ROLES = ["asset_manager", "asset_admin", "super_admin"];
const READER_ROLES = [...ASSET_ROLES, "audit_officer", "finance_officer", "finance_admin"];
const DEFAULT_IT_CATEGORY = "77777777-0001-0000-0000-000000000001";
// Checker roles for AUC capitalisation (the maker may be any ASSET_ROLES member).
const APPROVER_ROLES = ["asset_admin", "super_admin"];
// Asset settings (GL heads) are shared with finance: a finance_admin may request and approve them too.
const SETTINGS_ROLES = ["asset_admin", "finance_admin", "super_admin"];
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const leaseBody = z.object({
  leaseNo: z.string().trim().min(1).max(64),
  lessorName: z.string().trim().min(1).max(256),
  rouCostMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  // Optional when ibrBps + paymentMinor are given: the service then discounts the payments itself.
  liabilityMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  leaseStart: isoDate,
  leaseEnd: isoDate,
  ibrBps: z.number().int().min(0).max(10_000).optional(),
  paymentMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  paymentFrequency: z.enum(["monthly", "quarterly", "annual"]).default("monthly"),
}).refine((b) => (b.ibrBps === undefined) === (b.paymentMinor === undefined), {
  message: "ibrBps and paymentMinor must be given together",
}).refine((b) => b.liabilityMinor !== undefined || b.ibrBps !== undefined, {
  message: "give liabilityMinor, or ibrBps with paymentMinor",
}).refine((b) => b.leaseEnd > b.leaseStart, { message: "leaseEnd must be after leaseStart" });

/** Discount the payments when the body carries an IBR; null for a manual-liability lease. */
function scheduleFor(b: z.infer<typeof leaseBody>) {
  if (b.ibrBps === undefined || b.paymentMinor === undefined) return null;
  try {
    return buildLeaseSchedule({
      leaseStart: b.leaseStart, leaseEnd: b.leaseEnd, paymentMinor: BigInt(b.paymentMinor),
      ibrBps: b.ibrBps, frequency: b.paymentFrequency as LeaseFrequency,
    });
  } catch (e) {
    throw new HttpError(400, "INVALID_LEASE_TERMS", e instanceof Error ? e.message : "invalid lease terms");
  }
}

export async function enterpriseRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/assets/scan/:barcode", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { barcode } = z.object({ barcode: z.string().min(1) }).parse(req.params);
    // Lookup is tenant-scoped (WHERE tenant_id + FORCE RLS), so another tenant's barcode is a 404.
    const asset = await repo.findAssetByBarcode(ctx.tenantId, barcode);
    // GAP-ASSETS-SCAN-06: every scan (hit or miss) is logged as physical-verification evidence.
    // The route only publishes; the consumer writes the row.
    await publishF3Write(ctx, "scan_log", randomUUID(), { barcode, assetId: asset?.id ?? null, found: !!asset });
    if (!asset) throw new HttpError(404, "NOT_FOUND", "no asset for barcode");
    return reply.send({ id: asset.id, code: asset.code, name: asset.name, barcode: asset.barcode, status: asset.status, bookValue: Number(asset.bookValue) });
  });

  app.get("/v1/assets/projects/auc", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 100));
    const offset = Math.max(0, Number(q.offset) || 0);
    const all = await repo.listAuc(ctx.tenantId);
    return reply.send({ data: all.slice(offset, offset + limit) });
  });

  app.post("/v1/assets/projects/auc", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const body = z.object({ projectCode: z.string(), name: z.string(), wbsRef: z.string().optional(), amountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0), reason: z.string().trim().min(3).max(500) }).parse(req.body);
    const id = randomUUID();
    // amountMinor is PAISE; z.number().int() must stay a safe integer (the web form rejects larger values client-side).
    await publishF3Write(ctx, "auc_create", id, { projectCode: body.projectCode, name: body.name, wbsRef: body.wbsRef, amountMinor: body.amountMinor, reason: body.reason });
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/assets/projects/auc/:id/capitalize", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const auc = await repo.findAucById(id, ctx.tenantId);
    if (!auc) throw new HttpError(404, "NOT_FOUND", "AUC not found");
    if (auc.status !== "under_construction") throw new HttpError(409, "AUC_NOT_CAPITALIZABLE", `AUC is already ${auc.status.replace(/_/g, " ")}`);
    const body = z.object({
      // Both depreciation books start from this date; defaults to today (IST).
      capitalizationDate: isoDate.refine((v) => isRealDateNotAfterToday(v), { message: "capitalizationDate must be a real date, not after today (IST)" }).optional(),
      reason: z.string().trim().min(3).max(500),
    }).parse(req.body);
    const capitalizationDate = body.capitalizationDate ?? todayIST();
    // No GL head defaults: refuse (409) until the CWIP head is configured and valid, so nothing can be capitalised
    // without a journal that can post. (A zero-cost project has no journal.)
    if (auc.accumulatedMinor > 0n) await requireGlHeads(ctx.tenantId, ["cwip", "fixed_asset"], ctx.correlationId);
    const settings = await repo.getAssetSettings(ctx.tenantId);
    if (settings?.capitalizeMakerChecker ?? true) {
      // Maker step: the checker (a different asset_admin/super_admin) approves via /capitalize/approve.
      await publishF3Write(ctx, "auc_capitalize_request", id, { aucId: id, capitalizationDate, reason: body.reason });
      return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
    }
    const assetId = randomUUID();
    await publishF3Write(ctx, "auc_capitalize", assetId, { aucId: id, assetId, capitalizationDate, reason: body.reason });
    return sendAccepted(reply, acceptedResponseSchema, { id: assetId, status: "accepted", correlationId: ctx.correlationId });
  });

  // GAP-ASSETS-PROJECTS-09: the checker. Maker != checker is enforced here AND by the consumer's conditional UPDATE.
  app.post("/v1/assets/projects/auc/:id/capitalize/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const auc = await repo.findAucById(id, ctx.tenantId);
    if (!auc) throw new HttpError(404, "NOT_FOUND", "AUC not found");
    if (auc.status !== "pending_capitalization") throw new HttpError(409, "AUC_NOT_PENDING", "AUC is not awaiting capitalisation approval");
    if (auc.capRequestedBy === ctx.actorId) throw new HttpError(403, "MAKER_CHECKER", "a different approver must approve this capitalisation");
    if (auc.accumulatedMinor > 0n) await requireGlHeads(ctx.tenantId, ["cwip", "fixed_asset"], ctx.correlationId);
    const assetId = randomUUID();
    await publishF3Write(ctx, "auc_capitalize_approve", assetId, { aucId: id, assetId });
    return sendAccepted(reply, acceptedResponseSchema, { id: assetId, status: "accepted", correlationId: ctx.correlationId });
  });

  // Repost a FAILED capitalisation journal (e.g. after the chart of accounts was fixed). asset_admin only; the heads are
  // re-validated; the consumer flips failed -> pending in one conditional UPDATE and re-enqueues the same journal.
  app.post("/v1/assets/projects/auc/:id/journal/repost", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const auc = await repo.findAucById(id, ctx.tenantId);
    if (!auc) throw new HttpError(404, "NOT_FOUND", "AUC not found");
    if (auc.status !== "capitalized" || auc.glPostStatus !== "failed") throw new HttpError(409, "JOURNAL_NOT_FAILED", "the journal for this project is not in a failed state");
    await requireGlHeads(ctx.tenantId, ["cwip", "fixed_asset"], ctx.correlationId);
    await publishF3Write(ctx, "auc_journal_repost", id, { aucId: id });
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/assets/projects/auc/:id/capitalize/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
    const auc = await repo.findAucById(id, ctx.tenantId);
    if (!auc) throw new HttpError(404, "NOT_FOUND", "AUC not found");
    if (auc.status !== "pending_capitalization") throw new HttpError(409, "AUC_NOT_PENDING", "AUC is not awaiting capitalisation approval");
    await publishF3Write(ctx, "auc_capitalize_reject", id, { aucId: id, reason: body.reason });
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });

  // Per-tenant asset policy: capitalisation maker-checker (default ON) and the GL heads (NO defaults; unset until configured).
  app.get("/v1/assets/settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const s = await repo.getAssetSettings(ctx.tenantId);
    const pendingAll = await repo.listPendingSettingRequests(ctx.tenantId);
    const pending = pendingAll.find((r) => r.kind === "maker_checker_off") ?? null;
    return reply.send({
      capitalizeMakerChecker: s?.capitalizeMakerChecker ?? true,
      // GL head edits and switching this off need a second approver (default ON).
      glMakerChecker: s?.glMakerChecker ?? true,
      sweepLimit: SWEEP_LIMIT,
      pendingRequests: pendingAll.map((r) => ({
        id: r.id, kind: r.kind, reason: r.reason, requestedAt: r.requestedAt, requestedByMe: r.requestedBy === ctx.actorId,
        heads: r.kind === "gl_heads_change" ? (r.payload ?? {}) : null,
      })),
      cwipAccountCode: s?.cwipAccountCode ?? null,
      fixedAssetAccountCode: s?.fixedAssetAccountCode ?? null,
      impairmentExpenseAccountCode: s?.impairmentExpenseAccountCode ?? null,
      revaluationReserveAccountCode: s?.revaluationReserveAccountCode ?? null,
      grnClearingAccountCode: s?.grnClearingAccountCode ?? null,
      acquisitionOffsetAccountCode: s?.acquisitionOffsetAccountCode ?? null,
      maintenanceExpenseAccountCode: s?.maintenanceExpenseAccountCode ?? null,
      apControlAccountCode: s?.apControlAccountCode ?? null,
      // Per posting area: which GL accounts are still unset (drives the "Accounting not set up" banner), and how many
      // records are waiting for / were refused by finance.
      accounting: accountingStatus(s),
      glOpen: await repo.countGlOpen(ctx.tenantId),
      rouAccountCode: s?.rouAccountCode ?? null,
      leaseLiabilityAccountCode: s?.leaseLiabilityAccountCode ?? null,
      leaseOffsetAccountCode: s?.leaseOffsetAccountCode ?? null,
      pendingMakerCheckerOff: pending ? { id: pending.id, requestedAt: pending.requestedAt, reason: pending.reason, requestedByMe: pending.requestedBy === ctx.actorId } : null,
    });
  });

  const headCode = z.string().trim().regex(/^[A-Za-z0-9._-]{1,16}$/).nullable().optional();
  app.patch("/v1/assets/settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SETTINGS_ROLES);
    const body = z.object({
      capitalizeMakerChecker: z.boolean().optional(),
      glMakerChecker: z.boolean().optional(),
      cwipAccountCode: headCode, fixedAssetAccountCode: headCode, impairmentExpenseAccountCode: headCode, revaluationReserveAccountCode: headCode,
      grnClearingAccountCode: headCode, acquisitionOffsetAccountCode: headCode, maintenanceExpenseAccountCode: headCode, apControlAccountCode: headCode, rouAccountCode: headCode, leaseLiabilityAccountCode: headCode, leaseOffsetAccountCode: headCode,
      reason: z.string().trim().min(3).max(500),
    }).refine((b) => Object.keys(b).some((k) => k !== "reason" && (b as Record<string, unknown>)[k] !== undefined), { message: "nothing to update" }).parse(req.body);
    // finance_admin is limited to GL-head requests: the capitalisation approval control stays asset_admin / super_admin.
    if (body.capitalizeMakerChecker !== undefined) requireRole(ctx, APPROVER_ROLES);
    // Fast-fail pre-check. The CONSUMER repeats it on the locked settings row (the authoritative check): each head is checked
    // against the finance chart of accounts (exists, active, leaf, right type, not accumulated depreciation) and the merged
    // set must have no duplicates. Clearing a head (null) needs no chart check.
    const kinds: Array<[HeadKind, keyof typeof body]> = [
      ["cwip", "cwipAccountCode"], ["fixed_asset", "fixedAssetAccountCode"], ["impairment_expense", "impairmentExpenseAccountCode"], ["revaluation_reserve", "revaluationReserveAccountCode"],
      ["grn_clearing", "grnClearingAccountCode"], ["acquisition_offset", "acquisitionOffsetAccountCode"], ["maintenance_expense", "maintenanceExpenseAccountCode"], ["ap_control", "apControlAccountCode"],
      ["rou", "rouAccountCode"], ["lease_liability", "leaseLiabilityAccountCode"], ["lease_offset", "leaseOffsetAccountCode"],
    ];
    for (const [kind, field] of kinds) {
      const code = body[field] as string | null | undefined;
      if (typeof code !== "string") continue;
      const check = await validateHead(ctx.tenantId, kind, code, ctx.correlationId);
      if (!check.ok) {
        if (check.reason === "UNAVAILABLE") throw new HttpError(503, "FINANCE_UNAVAILABLE", reasonMessage(kind, code, check));
        throw new HttpError(409, "GL_HEAD_INVALID", reasonMessage(kind, code, check));
      }
    }
    const current = await repo.getAssetSettings(ctx.tenantId);
    const merged = headsFromSettings(current, ALL_HEAD_KINDS);
    for (const [kind, field] of kinds) {
      const v = body[field] as string | null | undefined;
      if (v === null) delete merged[kind];
      else if (typeof v === "string") merged[kind] = v;
    }
    assertDistinctHeads(merged);

    const glMc = current?.glMakerChecker ?? true;
    const turnGlOn = Boolean(body.glMakerChecker) && !glMc; // already ON: nothing to do
    // While approval is ON every head change is a pending request, even if the same PATCH also says glMakerChecker:true
    // (that part is a no-op: it is already ON). Only when it is OFF do heads apply directly (a PATCH turning it ON then
    // applies the heads first, under the OFF policy it is leaving, and switches it ON in the same locked transaction).
    const headsNeedApproval = glMc;
    const headFields = Object.fromEntries(kinds.filter(([, f]) => body[f] !== undefined).map(([, f]) => [f, body[f]]));
    const hasHeads = Object.keys(headFields).length > 0;
    const pendingKinds = new Set((await repo.listPendingSettingRequests(ctx.tenantId)).map((r) => r.kind));
    const requestIds: string[] = [];
    const queueRequest = async (kind: string, extra: Record<string, unknown> = {}) => {
      if (pendingKinds.has(kind)) throw new HttpError(409, "REQUEST_PENDING", "a request of this kind is already awaiting approval");
      const rid = randomUUID();
      await publishF3Write(ctx, "settings_request", rid, { kind, reason: body.reason, ...extra });
      requestIds.push(rid);
    };
    // Weakening a control needs a SECOND approver (the same pending-request pattern as capitalisation).
    if (body.capitalizeMakerChecker === false) {
      if (!(current?.capitalizeMakerChecker ?? true)) throw new HttpError(409, "ALREADY_OFF", "capitalisation maker-checker is already off");
      await queueRequest("maker_checker_off");
    }
    if (body.glMakerChecker === false) {
      if (!glMc) throw new HttpError(409, "ALREADY_OFF", "GL maker-checker is already off");
      await queueRequest("gl_maker_checker_off");
    }
    // GL head edits: with GL maker-checker ON (default) they are a pending request a DIFFERENT approver must approve; the
    // deferred-journal sweep runs only after that approval. With it OFF they apply directly.
    if (hasHeads && headsNeedApproval) await queueRequest("gl_heads_change", { heads: headFields });
    const direct = body.capitalizeMakerChecker === true || turnGlOn || (hasHeads && !headsNeedApproval);
    const id = randomUUID();
    if (direct) {
      await publishF3Write(ctx, "asset_settings_update", id, {
        capitalizeMakerChecker: body.capitalizeMakerChecker === true ? true : undefined,
        glMakerChecker: turnGlOn ? true : undefined,
        ...(hasHeads && !headsNeedApproval ? headFields : {}),
        reason: body.reason,
      });
    }
    return sendAccepted(reply, acceptedResponseSchema, { id: requestIds[0] ?? id, status: "accepted", correlationId: ctx.correlationId });
  });

  // Post the journals that were deferred while accounts were missing, and re-send ones finance rejected. Bounded per run:
  // `more` says records are left over, so the screen can show "N more waiting - run again".
  app.post("/v1/assets/settings/post-pending", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SETTINGS_ROLES);
    const open = await repo.countGlOpen(ctx.tenantId);
    const waitingAssets = open.assetsAwaiting + open.assetsFailed;
    const waitingWorkOrders = open.workOrdersAwaiting + open.workOrdersFailed;
    const id = randomUUID();
    await publishF3Write(ctx, "gl_post_pending", id, {});
    return reply.code(202).send({
      id, status: "accepted", correlationId: ctx.correlationId,
      waiting: waitingAssets + waitingWorkOrders, limit: SWEEP_LIMIT,
      more: waitingAssets > SWEEP_LIMIT || waitingWorkOrders > SWEEP_LIMIT,
    });
  });

  app.post("/v1/assets/settings/requests/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SETTINGS_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ reason: z.string().trim().max(500).optional() }).parse(req.body ?? {});
    const r = await repo.findSettingRequest(ctx.tenantId, id);
    if (!r) throw new HttpError(404, "NOT_FOUND", "request not found");
    if (r.status !== "pending") throw new HttpError(409, "REQUEST_NOT_PENDING", "this request has already been decided");
    if (r.kind === "maker_checker_off") requireRole(ctx, APPROVER_ROLES); // capitalisation control: not finance_admin
    if (r.requestedBy === ctx.actorId) throw new HttpError(403, "MAKER_CHECKER", "a different approver must approve this request");
    await publishF3Write(ctx, "settings_request_approve", id, { reason: body.reason ?? null });
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/assets/settings/requests/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SETTINGS_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
    const r = await repo.findSettingRequest(ctx.tenantId, id);
    if (!r) throw new HttpError(404, "NOT_FOUND", "request not found");
    if (r.status !== "pending") throw new HttpError(409, "REQUEST_NOT_PENDING", "this request has already been decided");
    if (r.kind === "maker_checker_off") requireRole(ctx, APPROVER_ROLES);
    await publishF3Write(ctx, "settings_request_reject", id, { reason: body.reason });
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.get("/v1/assets/leases", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 100));
    const offset = Math.max(0, Number(q.offset) || 0);
    const all = await repo.listLeases(ctx.tenantId);
    return reply.send({ data: all.slice(offset, offset + limit) });
  });

  app.post("/v1/assets/leases", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const body = leaseBody.parse(req.body);
    const schedule = scheduleFor(body);
    // With an IBR the liability IS the present value of the payments; a different user-entered figure is rejected.
    // Number.isSafeInteger(liabilityMinor) is enforced right below before it is published.
    const liabilityMinor = schedule ? Number(schedule.liabilityMinor) : (body.liabilityMinor as number); // precision-ok
    if (schedule && body.liabilityMinor !== undefined && body.liabilityMinor !== liabilityMinor) {
      throw new HttpError(400, "LIABILITY_MISMATCH", `lease liability must equal the present value of the payments (${liabilityMinor} minor units)`);
    }
    if (liabilityMinor <= 0 || !Number.isSafeInteger(liabilityMinor)) throw new HttpError(400, "INVALID_LEASE_TERMS", "lease liability must be a positive amount");
    // No GL head defaults: the ROU asset and lease liability heads (and the clearing head when ROU differs from the
    // liability) must be configured and valid, or the lease is refused with 409 -- never recognised without a journal.
    await requireGlHeads(ctx.tenantId, body.rouCostMinor === liabilityMinor ? ["rou", "lease_liability"] : ["rou", "lease_liability", "lease_offset"], ctx.correlationId);
    const leaseId = randomUUID();
    const assetId = randomUUID();
    const code = `ROU/${body.leaseNo}`;
    await publishF3Write(ctx, "lease_create", leaseId, {
      leaseId,
      assetId,
      leaseNo: body.leaseNo,
      lessorName: body.lessorName,
      rouCostMinor: body.rouCostMinor,
      liabilityMinor,
      leaseStart: body.leaseStart,
      leaseEnd: body.leaseEnd,
      ...(schedule ? { ibrBps: body.ibrBps, paymentMinor: body.paymentMinor, paymentFrequency: body.paymentFrequency } : {}),
      code,
      usefulLifeYears: Math.max(1, Math.ceil((new Date(body.leaseEnd).getTime() - new Date(body.leaseStart).getTime()) / (365.25 * 86400000))),
    });
    return sendAccepted(reply, acceptedResponseSchema, { id: leaseId, status: "accepted", correlationId: ctx.correlationId });
  });

  // Pure preview (no write): the discounted liability and amortisation schedule for the given terms.
  app.post("/v1/assets/leases/:id/journal/repost", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, APPROVER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const lease = await repo.findLeaseById(ctx.tenantId, id);
    if (!lease) throw new HttpError(404, "NOT_FOUND", "lease not found");
    if (lease.glPostStatus !== "failed") throw new HttpError(409, "JOURNAL_NOT_FAILED", "the journal for this lease is not in a failed state");
    await requireGlHeads(ctx.tenantId, lease.rouCostMinor === lease.liabilityMinor ? ["rou", "lease_liability"] : ["rou", "lease_liability", "lease_offset"], ctx.correlationId);
    await publishF3Write(ctx, "lease_journal_repost", id, { leaseId: id });
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/assets/leases/preview", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const body = leaseBody.parse(req.body);
    const schedule = scheduleFor(body);
    if (!schedule) throw new HttpError(400, "INVALID_LEASE_TERMS", "ibrBps and paymentMinor are needed to compute a schedule");
    return reply.send({
      liabilityMinor: schedule.liabilityMinor.toString(),
      totalInterestMinor: schedule.totalInterestMinor.toString(),
      periods: schedule.rows.length,
    });
  });

  app.get("/v1/assets/leases/:id/schedule", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (!(await repo.findLeaseById(ctx.tenantId, id))) throw new HttpError(404, "NOT_FOUND", "lease not found");
    const rows = await repo.listLeaseSchedule(ctx.tenantId, id);
    return reply.send({ data: rows.map((r) => ({
      seq: r.seq, dueDate: r.dueDate, openingMinor: r.openingMinor.toString(), interestMinor: r.interestMinor.toString(),
      paymentMinor: r.paymentMinor.toString(), principalMinor: r.principalMinor.toString(), closingMinor: r.closingMinor.toString(),
    })) });
  });

  app.post("/v1/assets/assets/:id/impairment", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ amountMinor: z.number().int().positive(), reason: z.string().optional(), eventDate: z.string().optional() }).parse(req.body);
    const asset = await registerRepo.findAssetById(id, ctx.tenantId);
    if (!asset) throw new HttpError(404, "NOT_FOUND", "asset not found");
    // no default fixed-asset head: it must be configured (and valid) before a journal-posting write
    await requireGlHeads(ctx.tenantId, ["fixed_asset", "impairment_expense"], ctx.correlationId);
    const before = asset.bookValue;
    const after = before - BigInt(body.amountMinor);
    if (after < 0n) throw new HttpError(400, "INVALID", "impairment exceeds book value");
    const evId = randomUUID();
    const eventDate = body.eventDate ?? new Date().toISOString().slice(0, 10);
    await publishF3Write(ctx, "impairment", evId, {
      assetId: id,
      amountMinor: body.amountMinor,
      bookValueBefore: before.toString(),
      bookValueAfter: after.toString(),
      accumulatedDep: asset.accumulatedDep.toString(),
      reason: body.reason,
      eventDate,
    });
    return sendAccepted(reply, acceptedResponseSchema, { id: evId, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/assets/assets/:id/revaluation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ newBookValueMinor: z.number().int().positive(), reason: z.string().optional() }).parse(req.body);
    const asset = await registerRepo.findAssetById(id, ctx.tenantId);
    if (!asset) throw new HttpError(404, "NOT_FOUND", "asset not found");
    // no default fixed-asset head: it must be configured (and valid) before a journal-posting write
    await requireGlHeads(ctx.tenantId, ["fixed_asset", "revaluation_reserve"], ctx.correlationId);
    const before = asset.bookValue;
    const after = BigInt(body.newBookValueMinor);
    const isUpward = after > before;
    const delta = isUpward ? after - before : before - after;
    const evId = randomUUID();
    const eventDate = new Date().toISOString().slice(0, 10);
    await publishF3Write(ctx, "revaluation", evId, {
      assetId: id,
      bookValueBefore: before.toString(),
      bookValueAfter: after.toString(),
      delta: delta.toString(),
      isUpward,
      accumulatedDep: asset.accumulatedDep.toString(),
      reason: body.reason,
      eventDate,
    });
    return sendAccepted(reply, acceptedResponseSchema, { id: evId, status: "accepted", correlationId: ctx.correlationId });
  });

  app.get("/v1/assets/locations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = req.query as { limit?: string; offset?: string };
    const limit = Math.min(100, Math.max(1, Number(q.limit) || 100));
    const offset = Math.max(0, Number(q.offset) || 0);
    const q2 = req.query as { active?: string };
    const rows = await repo.listLocations(ctx.tenantId, limit, offset, q2.active === "true");
    return reply.send({ data: rows, limit, offset });
  });

  app.post("/v1/assets/locations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const body = z.object({
      code: z.string().trim().min(1).max(64), name: z.string().trim().min(1).max(256),
      // org_unit is varchar(64): reject longer values here instead of crashing the consumer.
      orgUnit: z.string().trim().max(64).optional(), parentId: z.string().uuid().optional(),
    }).parse(req.body);
    // GAP-ASSETS-LOCATIONS-06: (tenant_id, code) is UNIQUE in the table, but the insert runs in the
    // async consumer, so a duplicate used to be accepted (202) and then silently dropped. Reject it up front.
    if (await repo.findLocationByCode(ctx.tenantId, body.code)) {
      throw new HttpError(409, "DUPLICATE_CODE", "a location with this code already exists");
    }
    if (body.parentId && !(await repo.findLocationById(ctx.tenantId, body.parentId))) {
      throw new HttpError(400, "INVALID_PARENT", "parent location not found");
    }
    const id = randomUUID();
    await publishF3Write(ctx, "location_create", id, { code: body.code, name: body.name, orgUnit: body.orgUnit, parentId: body.parentId });
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });

  // GAP-ASSETS-LOCATIONS-02: edit name / org unit. The code is deliberately immutable.
  app.patch("/v1/assets/locations/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      name: z.string().trim().min(1).max(256).optional(),
      orgUnit: z.string().trim().max(64).nullable().optional(),
    }).refine((b) => b.name !== undefined || b.orgUnit !== undefined, { message: "nothing to update" }).parse(req.body);
    const existing = await repo.findLocationById(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "location not found");
    await publishF3Write(ctx, "location_update", id, { name: body.name, orgUnit: body.orgUnit === "" ? null : body.orgUnit });
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });

  // GAP-ASSETS-LOCATIONS-02: deactivate instead of delete -- assets keep their reference, and the
  // register picker stops offering the location. Refused while an active child location exists.
  app.post("/v1/assets/locations/:id/deactivate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ reason: z.string().trim().min(3).max(500) }).parse(req.body);
    const loc = await repo.findLocationById(ctx.tenantId, id);
    if (!loc) throw new HttpError(404, "NOT_FOUND", "location not found");
    if (!loc.isActive) throw new HttpError(409, "ALREADY_INACTIVE", "location is already deactivated");
    const children = await repo.listLocations(ctx.tenantId, 1000, 0, true);
    if (children.some((c) => c.parentId === id)) throw new HttpError(409, "HAS_ACTIVE_CHILDREN", "deactivate the child locations first");
    await publishF3Write(ctx, "location_deactivate", id, { reason: body.reason });
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/assets/locations/:id/reactivate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const loc = await repo.findLocationById(ctx.tenantId, id);
    if (!loc) throw new HttpError(404, "NOT_FOUND", "location not found");
    if (loc.isActive) throw new HttpError(409, "ALREADY_ACTIVE", "location is already active");
    if (loc.parentId) {
      const parent = await repo.findLocationById(ctx.tenantId, loc.parentId);
      if (parent && !parent.isActive) throw new HttpError(409, "PARENT_INACTIVE", "reactivate the parent location first");
    }
    await publishF3Write(ctx, "location_reactivate", id, {});
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/assets/work-orders/:id/spare-parts", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ partCode: z.string(), description: z.string().optional(), qty: z.number().int().positive().default(1), costMinor: z.number().int().nonnegative().default(0) }).parse(req.body);
    const partId = randomUUID();
    await publishF3Write(ctx, "spare_part", partId, { workOrderId: id, partCode: body.partCode, description: body.description, qty: body.qty, costMinor: body.costMinor });
    return sendAccepted(reply, acceptedResponseSchema, { id: partId, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/assets/assets/:id/request-disposal", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id: assetId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ disposalDate: z.string(), disposalMethod: z.string(), proceedsMinor: z.number().int().nonnegative().default(0), currency: z.string().default("INR"), notes: z.string().optional() }).parse(req.body);
    const pendingId = randomUUID();
    const wfId = randomUUID();
    await publishF3Write(ctx, "request_disposal", pendingId, {
      assetId,
      disposalDate: body.disposalDate,
      disposalMethod: body.disposalMethod,
      proceedsMinor: body.proceedsMinor,
      currency: body.currency,
      notes: body.notes,
      wfId,
    });
    return sendAccepted(reply, acceptedResponseSchema, { id: pendingId, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/assets/assets/:id/inter-org-transfer", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const { id: assetId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ fromOrg: z.string(), toOrg: z.string(), transferDate: z.string(), notes: z.string().optional() }).parse(req.body);
    const transferId = randomUUID();
    await publishF3Write(ctx, "inter_org_transfer", transferId, {
      assetId,
      fromOrg: body.fromOrg,
      toOrg: body.toOrg,
      transferDate: body.transferDate,
      notes: body.notes,
    });
    return sendAccepted(reply, acceptedResponseSchema, { id: transferId, status: "accepted", correlationId: ctx.correlationId });
  });

  app.post("/v1/assets/bulk/import", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ASSET_ROLES);
    const body = bulkImportBody.parse(req.body);
    // GAP-ASSETS-BULK-IMPORT-04: the key is forwarded by the BFF/gateway as
    // x-idempotency-key (idempotency-key kept as a fallback for direct callers).
    // It derives the batch id AND the queue messageId, so a retry is a no-op.
    const idemKey = parseIdempotencyKey(req.headers["x-idempotency-key"] ?? req.headers["idempotency-key"]);
    const batchId = idemKey ? uuidV5(`bulk-import:${ctx.tenantId}:${idemKey}`) : randomUUID();
    // A retry of an already-committed batch gets the original 202 back BEFORE the
    // duplicate-code preflight (its own codes are now "already in the register").
    if (idemKey && (await repo.bulkBatchExists(ctx.tenantId, batchId))) {
      return sendAccepted(reply, acceptedResponseSchema, { id: batchId, status: "accepted", correlationId: ctx.correlationId });
    }
    // GAP-ASSETS-BULK-IMPORT-03: a duplicate code would abort the whole batch
    // asynchronously (UNIQUE(tenant_id, code)) with nothing reaching the clerk,
    // so reject it up front -- both within the file and against the register.
    const inFile = duplicateCodes(body.assets.map((a) => a.code));
    if (inFile.length > 0) {
      throw new HttpError(409, "DUPLICATE_CODE", `duplicate asset code(s) in the file: ${summariseCodes(inFile)}`);
    }
    const existing = await repo.findExistingCodes(ctx.tenantId, body.assets.map((a) => a.code));
    if (existing.length > 0) {
      throw new HttpError(409, "DUPLICATE_CODE", `asset code(s) already in the register: ${summariseCodes(existing)}`);
    }
    const rows = body.assets.map((a) => ({
      id: randomUUID(), tenantId: ctx.tenantId, name: a.name, code: a.code,
      categoryId: DEFAULT_IT_CATEGORY, assetType: a.assetType, barcode: makeBarcode(a.code),
      status: "active" as const, acquisitionCost: BigInt(a.acquisitionCostMinor), salvageValue: 0n,
      usefulLifeYears: 5, depRate: "20", depMethod: "SLM" as const, currency: "INR" as const,
      bookValue: BigInt(a.acquisitionCostMinor), accumulatedDep: 0n,
      acquisitionDate: new Date().toISOString().slice(0, 10),
      poRef: null, grnRef: null, location: null, notes: `bulk:${batchId}`,
      orgUnit: a.orgUnit ?? null,
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    }));
    await publishF3Write(ctx, "bulk_import", batchId, { rows, reason: body.reason }, idemKey ? { messageId: batchId } : undefined);
    return sendAccepted(reply, acceptedResponseSchema, { id: batchId, status: "accepted", correlationId: ctx.correlationId });
  });

  // G12: Pending disposals list
  app.get("/v1/assets/pending-disposals", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ["asset_admin", "super_admin", "finance_officer"]);
    const rows = await repo.listPendingDisposals(ctx.tenantId);
    return reply.send({ data: rows.map((r) => ({
      id: r.id, assetId: r.assetId, requestedBy: r.createdBy,
      reason: r.notes, status: r.workflowStatus, createdAt: r.createdAt,
    })) });
  });

  // G13: Impairment history for an asset
  app.get("/v1/assets/assets/:id/impairments", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rows = await repo.listImpairments(ctx.tenantId, id);
    return reply.send({ data: rows });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, ...(err.details ? { details: err.details } : {}) });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
