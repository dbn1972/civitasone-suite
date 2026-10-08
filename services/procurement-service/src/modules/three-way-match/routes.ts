import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import type { ThreeWayMatchRow } from "./schema.js";
import * as poRepo from "../po/repo.js";
import * as grnRepo from "../grn/repo.js";
import * as commands from "./commands.js";
import { rupeesStringToMinor, invoiceTotalMinor } from "./money.js";
import { randomUUID } from "node:crypto";

const PROC_ROLES = ["procurement_officer", "procurement_admin", "finance_admin", "super_admin"];

const createBody = z.object({
  poId: z.string().uuid(),
  grnId: z.string().uuid(),
  invoiceId: z.string().uuid().optional(),
  invoiceAmountMinor: z.number().int().nonnegative().optional(),
  // DOM-027: required whenever invoice info is asserted (see the .refine()
  // below) -- closes the audit-trail asymmetry with POST
  // /v1/procurement/matches/invoice, which has always required a structured
  // invoiceRef. Same bound as that endpoint's own field.
  invoiceRef: z.string().min(1).max(128).optional(),
}).refine(
  (b) => (b.invoiceId === undefined && b.invoiceAmountMinor === undefined) || b.invoiceRef !== undefined,
  {
    message: "invoiceRef is required whenever invoice information (invoiceId/invoiceAmountMinor) is supplied",
    path: ["invoiceRef"],
  },
);

// GAP2-PROCUREMENT-THREEWAYMATCH-01: invoiceAmount/invoiceTax are now RUPEES
// DECIMAL STRINGS, converted to paise with exact BigInt arithmetic
// (rupeesStringToMinor) instead of the banned float `Number(x) * 100`. The
// `.refine()` rejects >2-decimal / non-numeric / negative input with a clean
// 400 rather than silently rounding a payment-gating amount. A paise-integer
// client (like the sibling direct endpoint) can still post an integer string
// such as "7" (0 decimals) — that is accepted and means 7 rupees -> 700 paise,
// consistent with "7.00"; callers wanting raw paise use the direct endpoint.
const invoiceAttachBody = z.object({
  matchId:       z.string().uuid(),
  invoiceRef:    z.string().min(1).max(128),
  invoiceDate:   z.string().optional(),
  invoiceAmount: z.string().trim().min(1).refine((v) => rupeesStringToMinor(v) !== null, {
    message: "invoiceAmount must be a non-negative rupees amount with at most 2 decimal places",
  }),
  invoiceTax:    z.string().trim().refine((v) => v.trim() === "" || rupeesStringToMinor(v) !== null, {
    message: "invoiceTax must be a non-negative rupees amount with at most 2 decimal places",
  }).default("0"),
  currency:      z.string().length(3).default("INR"),
});

function toApi(r: ThreeWayMatchRow): Record<string, unknown> {
  return {
    id: r.id,
    tenantId: r.tenantId,
    poId: r.poId,
    grnId: r.grnId,
    invoiceId: r.invoiceId,
    poAmountMinor: String(r.poAmountMinor),
    grnAmountMinor: String(r.grnAmountMinor),
    invoiceAmountMinor: r.invoiceAmountMinor != null ? String(r.invoiceAmountMinor) : null,
    // DOM-027: audited invoice reference. Mandatory at the HTTP boundary
    // (both write endpoints, below) whenever invoice info is supplied, and
    // surfaced here so it is genuinely visible in the read path -- not just
    // validated and discarded.
    invoiceRef: r.invoiceRef ?? null,
    // DOM-032: invoice date as supplied by the client. Optional (unlike
    // invoiceRef above, this endpoint's sibling matches/invoice field has no
    // required-whenever-invoice-info-present rule) -- surfaced here so it is
    // genuinely visible on the read path instead of validated and dropped.
    invoiceDate: r.invoiceDate ?? null,
    matchStatus: r.matchStatus,
    variancePct: r.variancePct,
    autoMatched: r.autoMatched,
    createdAt: r.createdAt,
    // DOM-011: per-axis computed variance + the threshold actually applied
    // at match time (see schema.ts/migration 0033).
    qtyVariancePct: r.qtyVariancePct,
    priceVariancePct: r.priceVariancePct,
    qtyTolerancePct: r.qtyTolerancePct,
    priceTolerancePct: r.priceTolerancePct,
    totalTolerancePct: r.totalTolerancePct,
  };
}

export async function threeWayMatchRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/procurement/three-way-match", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const body = createBody.parse(req.body);
    const po = await poRepo.findPoById(body.poId, ctx.tenantId);
    if (!po) throw new HttpError(404, "NOT_FOUND", "PO not found");
    const grn = await grnRepo.findGrnById(body.grnId);
    if (!grn || grn.tenantId !== ctx.tenantId) throw new HttpError(404, "NOT_FOUND", "GRN not found");
    const grnPoId = grn.poRef.replace(/^procurement_po:/, "");
    if (grnPoId !== body.poId) throw new HttpError(409, "GRN_PO_MISMATCH", "GRN does not belong to the supplied PO");
    return sendAccepted(reply, acceptedResponseSchema, await commands.runThreeWayMatch(ctx, body));
  });

  app.get("/v1/procurement/three-way-match", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const q = z.object({ poId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) }).parse(req.query);
    // GAP2-PROCUREMENT-GAPLIST-03: real COUNT(*) total, not the page length.
    const [rows, total] = await Promise.all([
      repo.listByTenant(ctx.tenantId, q.poId, q.limit, q.offset),
      repo.countByTenant(ctx.tenantId, q.poId),
    ]);
    return reply.send({ data: rows.map(toApi), total });
  });

  app.post("/v1/procurement/matches/invoice", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const body = invoiceAttachBody.parse(req.body);
    const existingMatch = await repo.findMatchById(body.matchId, ctx.tenantId);
    if (!existingMatch) throw new HttpError(404, "NOT_FOUND", "three-way match record not found");
    const invoiceId = randomUUID();
    // GAP2-PROCUREMENT-THREEWAYMATCH-01: exact BigInt conversion of the rupees
    // amount+tax to paise (the Zod refine above already guaranteed both parse),
    // never float `* 100`. The queue/consumer path carries invoiceAmountMinor
    // as a number today, so we pass the exact bigint stringified back through
    // Number() ONLY after it is an integral paise value — safe below 2^53 and
    // the direct endpoint's own schema caps there too; the string hop keeps the
    // conversion itself float-free end to end.
    const invoiceTotal = invoiceTotalMinor(body.invoiceAmount, body.invoiceTax);
    if (invoiceTotal === null) {
      throw new HttpError(400, "VALIDATION_FAILED", "invoice amount/tax must be rupees with at most 2 decimal places");
    }
    const invoiceAmountMinor = invoiceTotal;
    return sendAccepted(reply, acceptedResponseSchema, await commands.runThreeWayMatch(ctx, {
      poId: existingMatch.poId,
      grnId: existingMatch.grnId,
      invoiceId,
      // Carry paise as an exact base-10 STRING across the queue — the consumer
      // rebuilds a bigint with BigInt(...), so no Number() ever touches the
      // amount (precision-safe above 2^53, float-free end to end).
      invoiceAmountMinor: invoiceAmountMinor.toString(),
      // DOM-027: invoiceRef has always been REQUIRED by invoiceAttachBody
      // above, but was previously never forwarded past validation --
      // accepted, then silently discarded. Threaded through the same pipe
      // the direct endpoint now uses, so it is genuinely persisted
      // (procurement.three_way_match.invoice_ref) instead of just checked.
      invoiceRef: body.invoiceRef,
      // DOM-032: invoiceDate has always been ACCEPTED (optionally) by
      // invoiceAttachBody above, but was never forwarded past validation
      // either -- the exact same discard shape invoiceRef had before
      // DOM-027. Threaded through the same pipe, so it is genuinely
      // persisted (procurement.three_way_match.invoice_date) instead of
      // just validated and dropped.
      invoiceDate: body.invoiceDate,
    }));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
