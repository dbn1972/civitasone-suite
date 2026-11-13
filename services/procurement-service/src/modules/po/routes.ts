import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { posListResponseSchema } from "@civitasone/schemas/web";
import {sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { searchQuerySchema } from "../../shared/search.js";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createPoBody, gemOrderBody, dispatchBody, rejectPoBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as vendorRepo from "../vendor/repo.js";
import * as blacklistRepo from "../vendor-blacklist/repo.js";
import { assertEmpanelmentCurrent, assertNonEmpanelledOrderBasis, DomainError } from "../vendor/domain.js";
import * as tenderRepo from "../tender/repo.js";
import { assertCanDispatch, assertPoRejectable, assertTransitionAllowed, assertSanctionRefPresent, poTotalMinor, DomainError as PoDomainError, PO_APPROVAL_DEFINITION_CODE } from "./domain.js";
import { fetchSanctionBalance, rupeesFromMinor } from "./finance-budget-client.js";
import * as poRepo from "./repo.js";
import { resolveApprovalMode } from "../po-approval/mode.js";
import { assertWorkflowConfigured } from "../../shared/workflow-client.js";
import { zodFieldErrors } from "@civitasone/schemas/http";
import { idempotentCreate } from "../../shared/idempotency.js";
// Same read the PO consumer already does (po/consumer.ts reserveIndentBudget); used here only to
// answer an impossible PO synchronously. The consumer keeps the atomic reservation.
import * as indentRepo from "../indent/repo.js";
import { assertIndentApproved, DomainError as IndentDomainError } from "../indent/domain.js";

// GAP-PROCUREMENT-VENDORS-DETAIL-04: optional ?vendorId= on the PO list.
const vendorFilterSchema = z.object({ vendorId: z.string().uuid().optional() });

const PROC_ROLES   = ["procurement_officer", "procurement_admin", "super_admin"];
const READER_ROLES = [...PROC_ROLES, "audit_officer", "finance_officer"];
const PO_REJECT_ROLES = ["procurement_admin", "super_admin"];

/**
 * Synchronous vendor-eligibility gate for PO creation (422, nothing enqueued)
 * instead of a 202 that fails later in the consumer.
 *  - w0-report.md: reject a blacklisted vendor (tenant blacklist, central
 *    debarment by PAN, vendor's own 'blacklisted' type). The consumer keeps
 *    its in-transaction check as defence in depth.
 *  - GAP-PROCUREMENT-EMPANELMENT-05 / ORDERS-NEW-06: reject a vendor whose
 *    empanelment has lapsed. Applied to both POST aliases.
 */
/**
 * UAT Phase 2 follow-up: synchronous budget check. A PO citing a sanction whose
 * available balance is below the PO total used to be accepted (202) and then
 * dropped by the worker (BUDGET_EXCEEDED). Ask finance first (HTTP, outside any
 * transaction) and refuse with a readable 422. If finance cannot be asked, fall
 * through to the async path: the consumer re-checks and retries (never a
 * silent drop on unavailability). Returns the reason the synchronous check was
 * skipped (finance unavailable), or null, so the route can log it once the PO
 * id is known (security review #2446 (4): fail-open must be visible).
 */
async function assertPoBudget(ctx: { tenantId: string; correlationId?: string }, body: { items: Array<{ quantity: number; unitPriceMinor: number }>; sanctionRef?: string | undefined }): Promise<string | null> {
  if (!body.sanctionRef?.trim()) return null;
  const total = poTotalMinor(body.items);
  const balance = await fetchSanctionBalance(ctx.tenantId, body.sanctionRef, ctx.correlationId);
  if (balance.kind === "not_found") {
    throw new HttpError(422, "SANCTION_NOT_FOUND", "The budget sanction cited on this purchase order was not found. Choose an approved sanction.");
  }
  if (balance.kind === "ok" && total > balance.available) {
    throw new HttpError(
      422,
      "BUDGET_EXCEEDED",
      `The purchase order total ${rupeesFromMinor(total)} exceeds the ${rupeesFromMinor(balance.available)} still available on the cited budget sanction. Reduce the order or cite a sanction with enough balance.`,
    );
  }
  return balance.kind === "unavailable" ? balance.reason : null;
}

const REF_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * UAT T-EDGE TE-04 (P08): a PO citing an indent that does not exist, is not approved, or has
 * no headroom left was 202-accepted and then dropped by the worker with only a
 * po.budget_exceeded INDENT_NOT_FOUND event the maker never saw. The same rules are
 * checked here, from procurement data, so the maker gets an immediate 422 on the
 * indentRef field. The guarded reservation in the consumer stays the race-safe authority.
 */
async function assertIndentUsable(tenantId: string, indentRef: string, items: Array<{ quantity: number; unitPriceMinor: number }>): Promise<void> {
  const indentId = indentRef.replace(/^.*:/, "");
  const indent = REF_UUID_RE.test(indentId) ? await indentRepo.findIndentById(indentId) : null;
  if (!indent || indent.tenantId !== tenantId) {
    throw new HttpError(422, "INDENT_NOT_FOUND", "the indent cited on this purchase order was not found", [
      { field: "indentRef", message: "Choose an existing, approved indent.", code: "INDENT_NOT_FOUND" },
    ]);
  }
  try {
    assertIndentApproved(indent.status ?? "draft");
  } catch (err) {
    if (err instanceof IndentDomainError) {
      throw new HttpError(422, err.code, err.message, [{ field: "indentRef", message: "The indent must be approved before a purchase order is raised.", code: err.code }]);
    }
    throw err;
  }
  const remaining = BigInt(indent.totalMinor) - BigInt(indent.committedMinor ?? 0n);
  if (poTotalMinor(items) > remaining) {
    throw new HttpError(422, "INDENT_BUDGET_EXCEEDED", `the purchase order total exceeds the ${rupeesFromMinor(remaining)} still uncommitted on indent ${indent.indentNo}`, [
      { field: "items", message: "The order is more than the indent still allows.", code: "INDENT_BUDGET_EXCEEDED" },
    ]);
  }
}

/** UAT Phase 2 C2: synchronous 422 for a high-value PO with no sanction reference. */
function assertPoSanction(body: { items: Array<{ quantity: number; unitPriceMinor: number }>; sanctionRef?: string | undefined }): void {
  try {
    assertSanctionRefPresent(body.items, body.sanctionRef);
  } catch (err) {
    if (err instanceof PoDomainError) throw new HttpError(422, err.code, err.message);
    throw err;
  }
}

async function assertVendorEligible(tenantId: string, vendorId: string, basis: { tenderId?: string | undefined; gemOrderRef?: string | undefined } = {}): Promise<void> {
  const vendor = await vendorRepo.findVendorById(vendorId, tenantId);
  const blacklisted =
    Boolean(await blacklistRepo.findActive(tenantId, vendorId))
    || (vendor?.pan ? (await blacklistRepo.findActiveCentralByPan(vendor.pan)) != null : false)
    || vendor?.vendorType === "blacklisted";
  if (blacklisted) {
    throw new HttpError(422, "VENDOR_BLACKLISTED", "vendor is blacklisted and cannot be used on a purchase order");
  }
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10); // IST calendar day
  try {
    const emp = await vendorRepo.findEmpanelmentsByVendor(vendorId, tenantId);
    assertEmpanelmentCurrent(emp, today);
    // D4c #28: a vendor with no empanelment record needs an awarded-tender / GeM basis.
    assertNonEmpanelledOrderBasis(emp, {
      tenderAwardedToVendor: emp.length === 0 && basis.tenderId
        ? await tenderRepo.isTenderAwardedToVendor(tenantId, basis.tenderId, vendorId)
        : false,
      gemOrderRef: basis.gemOrderRef,
    });
  } catch (err) {
    if (err instanceof DomainError) throw new HttpError(422, err.code, err.message);
    throw err;
  }
}

/**
 * F77: a PO is only ever approved through its `procurement_po_approval`
 * workflow task. In a tenant without that definition the consumer's instance
 * is rejected (R13), so the PO would sit in draft, unapprovable, behind a 202.
 * Refuse it up front with an explicit 422 instead. Fails open only when
 * workflow-service cannot be asked (null): the async path stays fail-closed.
 */
async function assertPoApprovalWorkflowConfigured(tenantId: string): Promise<void> {
  await assertWorkflowConfigured(tenantId, PO_APPROVAL_DEFINITION_CODE, "a purchase order could never be approved");
}

export async function poRoutes(app: FastifyInstance): Promise<void> {
  // Alias: /v1/procurement/orders → same handler as /v1/procurement/pos
  app.get("/v1/procurement/orders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const { q: search } = searchQuerySchema.parse(req.query);
    const { vendorId } = vendorFilterSchema.parse(req.query);
    sendValidated(reply, posListResponseSchema, await queries.listPos(ctx.tenantId, q.limit, q.offset, search, vendorId));
  });

  // Alias: /v1/procurement/purchase-orders → same as /pos (UAT compat)
  app.get("/v1/procurement/purchase-orders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const { q: search } = searchQuerySchema.parse(req.query);
    const { vendorId } = vendorFilterSchema.parse(req.query);
    sendValidated(reply, posListResponseSchema, await queries.listPos(ctx.tenantId, q.limit, q.offset, search, vendorId));
  });

  app.get("/v1/procurement/pos", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = listQuerySchema.parse(req.query);
    const { q: search } = searchQuerySchema.parse(req.query);
    const { vendorId } = vendorFilterSchema.parse(req.query);
    sendValidated(reply, posListResponseSchema, await queries.listPos(ctx.tenantId, q.limit, q.offset, search, vendorId));
  });

  app.post("/v1/procurement/pos", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const body = createPoBody.parse(req.body);
    // UAT T-EDGE TE-09: one PO per X-Idempotency-Key. The checks run inside, so a replay
    // is answered with the first 202 instead of being refused by the commitment it made.
    const accepted = await idempotentCreate(ctx, "procurement.po.create", body, async () => {
      // M10: a tenant without Finance (local approval mode) has no sanction to cite or check and no PO approval
      // workflow task; its POs are approved under the threshold matrix. Every other tenant: exactly as before.
      const localApproval = (await resolveApprovalMode(ctx.tenantId)) === "local";
      if (!localApproval) assertPoSanction(body);
      await assertVendorEligible(ctx.tenantId, body.vendorId, { tenderId: body.tenderId, gemOrderRef: body.gemOrderRef });
      if (!localApproval) await assertPoApprovalWorkflowConfigured(ctx.tenantId);
      const budgetSkipped = localApproval ? null : await assertPoBudget(ctx, body);
      await assertIndentUsable(ctx.tenantId, body.indentRef, body.items);
      const created = await commands.createPo(ctx, body);
      // Review #2446 (4): the synchronous sanction-balance check failed open
      // (finance unreachable) — the consumer will re-check. Log only the PO id,
      // correlation id and the transport reason (no PII, no amounts).
      if (budgetSkipped) req.log.warn({ poId: created.id, correlationId: ctx.correlationId, reason: budgetSkipped }, "po budget pre-check skipped: finance-service unavailable");
      return created;
    });
    return sendAccepted(reply, acceptedResponseSchema, accepted);
  });

  // F102: direct reject of a PO awaiting approval (draft / pending ->
  // cancelled). Checker action: same admin roles as amendment / plan approve.
  // The open workflow inbox task is closed by the consumer (close_by_ref).
  app.patch("/v1/procurement/pos/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PO_REJECT_ROLES);
    const { id } = idParam.parse(req.params);
    const body = rejectPoBody.parse(req.body ?? {});
    const po = await poRepo.findPoById(id, ctx.tenantId);
    if (!po) throw new HttpError(404, "NOT_FOUND", "purchase order not found");
    try {
      assertPoRejectable(po.status ?? "draft");
    } catch (err) {
      if (err instanceof PoDomainError) throw new HttpError(409, err.code, err.message);
      throw err;
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.rejectPo(ctx, id, body));
  });

  app.patch("/v1/procurement/pos/:id/dispatch", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = dispatchBody.parse(req.body ?? {});
    // D6: 404 for an unknown PO and 409 for a non-approved one, instead of a 202 the consumer then rejects.
    const po = await poRepo.findPoById(id, ctx.tenantId);
    if (!po) throw new HttpError(404, "NOT_FOUND", "purchase order not found");
    try {
      assertCanDispatch(po.status ?? "draft");
    } catch (err) {
      if (err instanceof PoDomainError) throw new HttpError(409, err.code, err.message);
      throw err;
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.dispatchPo(ctx, id, body));
  });

  // Submit a PO to eOffice for administrative approval. The eFile is raised via
  // the eOffice integration; the decision returns on procurement.po.file_decided
  // and moves the PO to approved/cancelled.
  app.post("/v1/procurement/pos/:id/submit-approval", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    // UAT W6-A: tenant-scoped existence read; unknown PO answers 404, not 202.
    const po = await poRepo.findPoById(id, ctx.tenantId);
    if (!po) throw new HttpError(404, "NOT_FOUND", "purchase order not found");
    // UAT bundle 22 (W5): a decided (approved / rejected / cancelled ...) or already pending PO cannot be submitted
    // again; refuse now (409) instead of a 202 the consumer then drops. Same rule the consumer applies.
    try {
      assertTransitionAllowed(po.status ?? "draft", "pending");
    } catch (err) {
      if (err instanceof PoDomainError) throw new HttpError(409, "INVALID_STATE_TRANSITION", `a ${po.status ?? "draft"} purchase order cannot be submitted for approval`);
      throw err;
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitPoForApproval(ctx, id));
  });

  app.post("/v1/procurement/pos/gem", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const body = gemOrderBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createGemOrder(ctx, body));
  });

  // D4c #25: resolve a PO reference for contract-service (service-to-service,
  // x-internal) so a contract can only quote a PO that exists. Registered before
  // /pos/:id so "resolve" is not read as an id. Tenant-scoped.
  app.get("/v1/procurement/pos/resolve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { ref } = z.object({ ref: z.string().trim().min(1).max(200) }).parse(req.query);
    const po = await queries.resolvePoRef(ctx.tenantId, ref);
    if (!po) throw new HttpError(404, "NOT_FOUND", "purchase order not found");
    return reply.send({ data: po });
  });

  app.get("/v1/procurement/pos/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const po = await queries.getPo(id, ctx.tenantId);
    if (!po) throw new HttpError(404, "NOT_FOUND", "purchase order not found");
    return reply.send(po);
  });


  // Alias: POST /v1/procurement/purchase-orders -> same as POST /pos (REST compat)
  app.post("/v1/procurement/purchase-orders", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const body = createPoBody.parse(req.body);
    // UAT T-EDGE TE-09: one PO per X-Idempotency-Key. The checks run inside, so a replay
    // is answered with the first 202 instead of being refused by the commitment it made.
    const accepted = await idempotentCreate(ctx, "procurement.po.create", body, async () => {
      // M10: a tenant without Finance (local approval mode) has no sanction to cite or check and no PO approval
      // workflow task; its POs are approved under the threshold matrix. Every other tenant: exactly as before.
      const localApproval = (await resolveApprovalMode(ctx.tenantId)) === "local";
      if (!localApproval) assertPoSanction(body);
      await assertVendorEligible(ctx.tenantId, body.vendorId, { tenderId: body.tenderId, gemOrderRef: body.gemOrderRef });
      if (!localApproval) await assertPoApprovalWorkflowConfigured(ctx.tenantId);
      const budgetSkipped = localApproval ? null : await assertPoBudget(ctx, body);
      await assertIndentUsable(ctx.tenantId, body.indentRef, body.items);
      const created = await commands.createPo(ctx, body);
      // Review #2446 (4): the synchronous sanction-balance check failed open
      // (finance unreachable) — the consumer will re-check. Log only the PO id,
      // correlation id and the transport reason (no PII, no amounts).
      if (budgetSkipped) req.log.warn({ poId: created.id, correlationId: ctx.correlationId, reason: budgetSkipped }, "po budget pre-check skipped: finance-service unavailable");
      return created;
    });
    return sendAccepted(reply, acceptedResponseSchema, accepted);
  });

  // Alias: GET /v1/procurement/purchase-orders/:id -> same as GET /pos/:id (REST compat)
  app.get("/v1/procurement/purchase-orders/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const po = await queries.getPo(id, ctx.tenantId);
    if (!po) throw new HttpError(404, "NOT_FOUND", "purchase order not found");
    return reply.send(po);
  });

  app.setErrorHandler(errorHandler);

}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: zodFieldErrors(err.issues) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false, ...(err.fieldErrors?.length ? { fieldErrors: err.fieldErrors } : {}) });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
