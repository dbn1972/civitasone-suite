/**
 * Scan-link (Finance target) — read routes + internal lookup. READ ONLY (the write path is the queue consumer).
 *
 * GET /v1/finance/payments/:id/scanned-documents   -- same roles that can already view a payment
 * GET /v1/finance/bills/:id/scanned-documents      -- same roles that can already view a bill
 * GET /v1/finance/vouchers/:id/scanned-documents   -- same roles that can read voucher prints
 * GET /internal/v1/scan-link/lookup?reference=&amountMinor=&kind=  -- service-to-service only (x-internal + service secret)
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { lookupResponseSchema } from "@civitasone/scan-link";
import { resolveContext, requireRole, HttpError, financeErrorHandler } from "../../shared/context.js";
import * as queries from "./queries.js";
import * as commands from "./commands.js";
import type { ScanTargetKind } from "./match.js";

// Mirror the roles that can already view the underlying record (payments/routes.ts, voucher-print/routes.ts).
const PAYMENT_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const BILL_ROLES    = [...PAYMENT_ROLES, "audit_officer", "procurement_officer"];
const VOUCHER_ROLES = [...PAYMENT_ROLES, "audit_officer"];

const idParam = z.object({ id: z.string().uuid() });
const KIND_ALIASES = { payment: "finance_payment", voucher: "finance_voucher", bill: "finance_bill",
  finance_payment: "finance_payment", finance_voucher: "finance_voucher", finance_bill: "finance_bill" } as const;
const lookupQuery = z.object({
  reference: z.string().trim().min(1).max(100),
  amountMinor: z.string().regex(/^\d{1,18}$/).optional(),
  kind: z.enum(["payment", "voucher", "bill", "finance_payment", "finance_voucher", "finance_bill"]).optional(),
});

export async function scanLinkRoutes(app: FastifyInstance): Promise<void> {
  const register = (path: string, kind: ScanTargetKind, roles: string[]): void => {
    app.get(path, async (req, reply) => {
      const ctx = resolveContext(req);
      requireRole(ctx, roles);
      const { id } = idParam.parse(req.params);
      const data = await queries.listScannedDocuments(ctx.tenantId, kind, id);
      if (data === null) throw new HttpError(404, "NOT_FOUND", "record not found");
      // DPDP audit-on-read: one event per successful view (not for 403/404); ids only, never content.
      await commands.auditScannedDocumentsView(ctx, { kind, targetId: id, documentIds: data.map((d) => d.documentId), route: path });
      return reply.send({ data });
    });
  };
  register("/v1/finance/payments/:id/scanned-documents", "finance_payment", PAYMENT_ROLES);
  register("/v1/finance/bills/:id/scanned-documents", "finance_bill", BILL_ROLES);
  register("/v1/finance/vouchers/:id/scanned-documents", "finance_voucher", VOUCHER_ROLES);

  app.get("/internal/v1/scan-link/lookup", async (req, reply) => {
    const ctx = resolveContext(req);
    // authPlugin only grants the elevated service context when x-internal + the shared secret verify; a user
    // token (actorType "user") never reaches this handler's data, whatever roles it carries.
    if (ctx.actorType !== "service_account" || req.headers["x-internal"] !== "1") {
      throw new HttpError(403, "FORBIDDEN", "internal service call required");
    }
    const q = lookupQuery.parse(req.query);
    const data = await queries.lookup(ctx.tenantId, {
      reference: q.reference,
      ...(q.amountMinor !== undefined ? { amountMinor: q.amountMinor } : {}),
      ...(q.kind ? { kind: KIND_ALIASES[q.kind] } : {}),
    });
    return reply.send(lookupResponseSchema.parse({ data }));
  });

  app.setErrorHandler(financeErrorHandler);
}
