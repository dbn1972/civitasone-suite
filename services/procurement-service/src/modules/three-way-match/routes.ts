import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const PROC_ROLES = ["procurement_officer", "procurement_admin", "finance_admin", "super_admin"];

interface ThreeWayMatch {
  id: string;
  tenantId: string;
  poId: string;
  grnId: string;
  invoiceId: string | null;
  poAmountMinor: string;
  grnAmountMinor: string;
  invoiceAmountMinor: string | null;
  matchStatus: string;
  variancePct: string;
  autoMatched: boolean;
  createdAt: string;
}

const store: ThreeWayMatch[] = [];

const createBody = z.object({
  poId: z.string().uuid(),
  grnId: z.string().uuid(),
  invoiceId: z.string().uuid().optional(),
  poAmountMinor: z.number().int(),
  grnAmountMinor: z.number().int(),
  invoiceAmountMinor: z.number().int().optional(),
});

export async function threeWayMatchRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/procurement/three-way-match", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const body = createBody.parse(req.body);

    // Auto-match logic: compare PO vs GRN vs Invoice amounts
    const poAmt = body.poAmountMinor;
    const grnAmt = body.grnAmountMinor;
    const invAmt = body.invoiceAmountMinor ?? null;

    let variance = Math.abs(poAmt - grnAmt) / Math.max(poAmt, 1) * 100;
    if (invAmt !== null) {
      const invVariance = Math.abs(poAmt - invAmt) / Math.max(poAmt, 1) * 100;
      variance = Math.max(variance, invVariance);
    }

    const autoMatched = variance <= 2; // 2% tolerance
    const matchStatus = autoMatched ? "matched" : variance <= 5 ? "partial" : "mismatched";

    const record: ThreeWayMatch = {
      id: crypto.randomUUID(),
      tenantId: ctx.tenantId,
      poId: body.poId,
      grnId: body.grnId,
      invoiceId: body.invoiceId ?? null,
      poAmountMinor: poAmt.toString(),
      grnAmountMinor: grnAmt.toString(),
      invoiceAmountMinor: invAmt?.toString() ?? null,
      matchStatus,
      variancePct: variance.toFixed(2),
      autoMatched,
      createdAt: new Date().toISOString(),
    };
    store.push(record);
    return reply.code(201).send({ data: record });
  });

  app.get("/v1/procurement/three-way-match", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PROC_ROLES);
    const q = z.object({
      poId: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    let rows = store.filter((r) => r.tenantId === ctx.tenantId);
    if (q.poId) rows = rows.filter((r) => r.poId === q.poId);
    return reply.send({ data: rows.slice(q.offset, q.offset + q.limit), total: rows.length });
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
