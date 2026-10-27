import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { posListResponseSchema } from "@civitasone/schemas/web";
import {sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { searchQuerySchema } from "../../shared/search.js";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { createPoBody, gemOrderBody, dispatchBody, idParam } from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as vendorRepo from "../vendor/repo.js";
import * as blacklistRepo from "../vendor-blacklist/repo.js";
import { assertEmpanelmentCurrent, assertNonEmpanelledOrderBasis, DomainError } from "../vendor/domain.js";
import * as tenderRepo from "../tender/repo.js";

// GAP-PROCUREMENT-VENDORS-DETAIL-04: optional ?vendorId= on the PO list.
const vendorFilterSchema = z.object({ vendorId: z.string().uuid().optional() });

const PROC_ROLES   = ["procurement_officer", "procurement_admin", "super_admin"];
const READER_ROLES = [...PROC_ROLES, "audit_officer", "finance_officer"];

/**
 * Synchronous vendor-eligibility gate for PO creation (422, nothing enqueued)
 * instead of a 202 that fails later in the consumer.
 *  - w0-report.md: reject a blacklisted vendor (tenant blacklist, central
 *    debarment by PAN, vendor's own 'blacklisted' type). The consumer keeps
 *    its in-transaction check as defence in depth.
 *  - GAP-PROCUREMENT-EMPANELMENT-05 / ORDERS-NEW-06: reject a vendor whose
 *    empanelment has lapsed. Applied to both POST aliases.
 */
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
    await assertVendorEligible(ctx.tenantId, body.vendorId, { tenderId: body.tenderId, gemOrderRef: body.gemOrderRef });
    return sendAccepted(reply, acceptedResponseSchema, await commands.createPo(ctx, body));
  });

  app.patch("/v1/procurement/pos/:id/dispatch", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
    const body = dispatchBody.parse(req.body ?? {});
    return sendAccepted(reply, acceptedResponseSchema, await commands.dispatchPo(ctx, id, body));
  });

  // Submit a PO to eOffice for administrative approval. The eFile is raised via
  // the eOffice integration; the decision returns on procurement.po.file_decided
  // and moves the PO to approved/cancelled.
  app.post("/v1/procurement/pos/:id/submit-approval", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const { id } = idParam.parse(req.params);
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
    await assertVendorEligible(ctx.tenantId, body.vendorId, { tenderId: body.tenderId, gemOrderRef: body.gemOrderRef });
    return sendAccepted(reply, acceptedResponseSchema, await commands.createPo(ctx, body));
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
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
