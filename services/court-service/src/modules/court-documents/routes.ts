/**
 * court-documents — HTTP routes that RENDER the court's legal PDF outputs from
 * existing data. Read-only: no writes, no new tables, no consumer. Every DB read
 * goes through the sibling modules' RLS-scoped repos, so tenant isolation is
 * enforced by PostgreSQL RLS (app.tenant_id GUC) as well as the app-layer WHERE.
 *
 * Endpoints (all return application/pdf, inline):
 *   GET /v1/court/cause-lists/:id/pdf        — cause list + its items
 *   GET /v1/court/orders/:id/pdf             — an order / judgment
 *   GET /v1/court/certified-copies/:id/pdf   — a certified copy of an order
 */
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { idParam } from "../court-registry/validators.js";
import * as causeListRepo from "../cause-list/repo.js";
import * as orderRepo from "../order/repo.js";
import * as certifiedCopyRepo from "../certified-copy/repo.js";
import * as courtRepo from "../court-registry/repo.js";
import { getCaseById } from "../case-registry/repo.js";
import { renderCauseListPdf, renderOrderPdf, renderCertifiedCopyPdf } from "./render.js";

/** Roles permitted to read/render court documents. */
const READ_ROLES = ["registrar", "court_admin", "super_admin", "judge", "court_clerk"];

/** Send a rendered PDF inline. */
function sendPdf(reply: import("fastify").FastifyReply, bytes: Uint8Array, filename: string): void {
  reply.header("content-type", "application/pdf");
  reply.header("content-disposition", `inline; filename="${filename}"`);
  reply.send(Buffer.from(bytes));
}

export async function courtDocumentsRoutes(app: FastifyInstance): Promise<void> {
  // ─── Cause list PDF ────────────────────────────────────────────────────────
  app.get("/v1/court/cause-lists/:id/pdf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);

    const causeList = await causeListRepo.getCauseList(ctx.tenantId, id);
    if (!causeList) throw new HttpError(404, "CAUSE_LIST_NOT_FOUND", "Cause list not found");

    const court = await courtRepo.getCourtById(ctx.tenantId, causeList.courtId);
    const items = await causeListRepo.listItems(ctx.tenantId, id);

    // Resolve each item's CNR (falls back to the case id) for the "CNR / Case" column.
    const rendered = await Promise.all(
      items.map(async (it) => {
        const kase = await getCaseById(ctx.tenantId, it.caseId);
        return {
          itemNo: it.itemNumber,
          caseRef: kase?.cnrNumber ?? it.caseId,
          slot: it.slot,
          courtroom: it.courtroom,
        };
      }),
    );

    const bytes = await renderCauseListPdf({
      courtName: court?.name ?? "—",
      listDate: causeList.listDate,
      items: rendered,
    });
    return sendPdf(reply, bytes, `cause-list-${id}.pdf`);
  });

  // ─── Order / judgment PDF ──────────────────────────────────────────────────
  app.get("/v1/court/orders/:id/pdf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);

    const order = await orderRepo.getOrderById(ctx.tenantId, id);
    if (!order) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");

    const kase = await getCaseById(ctx.tenantId, order.caseId);
    const court = kase?.courtId ? await courtRepo.getCourtById(ctx.tenantId, kase.courtId) : undefined;

    const bytes = await renderOrderPdf({
      courtName: court?.name ?? "—",
      caption: kase?.title ?? order.caseId,
      cnr: kase?.cnrNumber ?? "—",
      orderType: order.orderType,
      orderDate: order.orderDate,
      orderText: order.orderText ?? "",
      status: order.status,
      signedBy: order.signedBy,
      hasDsc: Boolean(order.dscSignature),
    });
    return sendPdf(reply, bytes, `order-${id}.pdf`);
  });

  // ─── Certified copy PDF ────────────────────────────────────────────────────
  app.get("/v1/court/certified-copies/:id/pdf", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);

    const copy = await certifiedCopyRepo.getCopy(ctx.tenantId, id);
    if (!copy) throw new HttpError(404, "CERTIFIED_COPY_NOT_FOUND", "Certified copy not found");

    // The certified copy is a copy of the ORDER — pull the order text (and the
    // case caption for the header). We deliberately do NOT print applicant PII.
    const order = copy.orderId ? await orderRepo.getOrderById(ctx.tenantId, copy.orderId) : undefined;
    const kase = await getCaseById(ctx.tenantId, copy.caseId);
    const court = kase?.courtId ? await courtRepo.getCourtById(ctx.tenantId, kase.courtId) : undefined;

    const bytes = await renderCertifiedCopyPdf({
      courtName: court?.name ?? "—",
      copyId: copy.id,
      status: copy.status,
      copiesCount: copy.copiesCount,
      issuedBy: copy.issuedBy,
      issuedAt: copy.issuedAt ? copy.issuedAt.toISOString() : null,
      orderText: order?.orderText ?? null,
      caption: kase?.title ?? undefined,
      cnr: kase?.cnrNumber ?? undefined,
    });
    return sendPdf(reply, bytes, `certified-copy-${id}.pdf`);
  });

  // Uniform error shaping (mirrors the sibling modules' envelope).
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "Invalid request", details: err.issues } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    _req.log.error({ err }, "court-documents route error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });
}
