import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];

interface BankRecon {
  id: string;
  tenantId: string;
  bankAccountId: string;
  statementDate: string;
  statementBalanceMinor: string;
  bookBalanceMinor: string;
  differenceMinor: string;
  reconciled: boolean;
  reconciledBy: string | null;
  reconciledAt: string | null;
  createdAt: string;
}

const store: BankRecon[] = [];

const createBody = z.object({
  bankAccountId: z.string().uuid(),
  statementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  statementBalanceMinor: z.number().int(),
  bookBalanceMinor: z.number().int(),
});

export async function bankReconRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/finance/bank-reconciliation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = createBody.parse(req.body);
    const difference = body.statementBalanceMinor - body.bookBalanceMinor;

    const record: BankRecon = {
      id: crypto.randomUUID(),
      tenantId: ctx.tenantId,
      bankAccountId: body.bankAccountId,
      statementDate: body.statementDate,
      statementBalanceMinor: body.statementBalanceMinor.toString(),
      bookBalanceMinor: body.bookBalanceMinor.toString(),
      differenceMinor: difference.toString(),
      reconciled: difference === 0,
      reconciledBy: difference === 0 ? ctx.actorId : null,
      reconciledAt: difference === 0 ? new Date().toISOString() : null,
      createdAt: new Date().toISOString(),
    };
    store.push(record);
    return reply.code(201).send({ data: record });
  });

  app.get("/v1/finance/bank-reconciliation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const q = z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    let rows = store.filter((r) => r.tenantId === ctx.tenantId);
    if (q.month) {
      rows = rows.filter((r) => r.statementDate.startsWith(q.month!));
    }
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
