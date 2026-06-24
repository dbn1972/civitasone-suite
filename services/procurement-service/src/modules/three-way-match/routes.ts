import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import * as repo from "./repo.js";
import type { ThreeWayMatchRow } from "./schema.js";
import * as poRepo from "../po/repo.js";
import * as grnRepo from "../grn/repo.js";

const PROC_ROLES = ["procurement_officer", "procurement_admin", "finance_admin", "super_admin"];

// Caller supplies references and (optionally) the external invoice amount only.
// PO and GRN amounts are DERIVED server-side from persisted rows.
const createBody = z.object({
  poId: z.string().uuid(),
  grnId: z.string().uuid(),
  invoiceId: z.string().uuid().optional(),
  invoiceAmountMinor: z.number().int().nonnegative().optional(),
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
    matchStatus: r.matchStatus,
    variancePct: r.variancePct,
    autoMatched: r.autoMatched,
    createdAt: r.createdAt,
  };
}

function diff(a: bigint, b: bigint): bigint { return a > b ? a - b : b - a; }

export async function threeWayMatchRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/procurement/three-way-match", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const body = createBody.parse(req.body);

    // DERIVE amounts from the real persisted PO and GRN (tenant-scoped).
    const po = await poRepo.findPoById(body.poId, ctx.tenantId);
    if (!po) throw new HttpError(404, "NOT_FOUND", "PO not found");
    const grn = await grnRepo.findGrnById(body.grnId);
    if (!grn || grn.tenantId !== ctx.tenantId) throw new HttpError(404, "NOT_FOUND", "GRN not found");

    // GRN must link back to this PO (validate linkage).
    const grnPoId = grn.poRef.replace(/^procurement_po:/, "");
    if (grnPoId !== body.poId) {
      throw new HttpError(409, "GRN_PO_MISMATCH", "GRN does not belong to the supplied PO");
    }

    const poItems = await poRepo.findPoItemsByPoId(body.poId, ctx.tenantId);
    const poItemMap = new Map(poItems.map((pi) => [pi.id, pi]));
    const grnItems = await grnRepo.findGrnItemsByGrnId(body.grnId);

    const poAmountMinor = BigInt(po.totalMinor);
    let grnAmountMinor = 0n;
    for (const gi of grnItems) {
      const poItem = poItemMap.get(gi.poItemRef);
      if (poItem) grnAmountMinor += BigInt(poItem.unitPriceMinor) * BigInt(gi.acceptedQty);
    }

    const invoiceAmountMinor = body.invoiceId !== undefined ? BigInt(body.invoiceAmountMinor ?? 0) : 0n;

    // Variance across the legs we have.
    let maxDiff = diff(poAmountMinor, grnAmountMinor);
    if (body.invoiceId !== undefined) {
      const invDiff = diff(poAmountMinor, invoiceAmountMinor);
      if (invDiff > maxDiff) maxDiff = invDiff;
    }
    const variancePct = poAmountMinor > 0n ? Number(maxDiff * 10000n / poAmountMinor) / 100 : 0;
    // Enum aligned to DB CHECK: pending | matched | mismatch | exception
    const matchStatus = variancePct <= 5 ? "matched" : "mismatch";

    await db.transaction(async (tx) => {
      await repo.upsertDerivedMatch(tx, {
        tenantId: ctx.tenantId,
        poId: body.poId,
        grnId: body.grnId,
        poAmountMinor,
        grnAmountMinor,
        matchStatus,
        invoiceId: body.invoiceId ?? null,
        invoiceAmountMinor,
      });
    });

    const row = await repo.findLatestForPoGrn(ctx.tenantId, body.poId, body.grnId);
    return reply.code(201).send({ data: row ? toApi(row) : null });
  });

  app.get("/v1/procurement/three-way-match", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const q = z.object({
      poId: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    const rows = await repo.listByTenant(ctx.tenantId, q.poId, q.limit, q.offset);
    return reply.send({ data: rows.map(toApi), total: rows.length });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
