import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import * as repo from "./repo.js";
import * as commands from "./commands.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];
const READER_ROLES = [...FINANCE_ROLES, "audit_officer"];

const importBody = z.object({
  bankAccountId: z.string().uuid(),
  statementRef: z.string().optional(),
  periodFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  openingMinor: z.number().int().optional(),
  closingMinor: z.number().int().optional(),
  lines: z.array(z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    amountMinor: z.number().int().positive(),
    direction: z.enum(["debit", "credit"]),
    narration: z.string().optional(),
    reference: z.string().optional(),
  })).min(1),
});

export async function bankReconRoutes(app: FastifyInstance): Promise<void> {
  // ── Import a bank statement (JSON line array) ───────────────────
  app.post("/v1/finance/bank-statements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const body = importBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.importStatement(ctx, body));
  });

  // ── Run auto-reconciliation for a statement ─────────────────────
  app.post("/v1/finance/bank-statements/:id/reconcile", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const q = z.object({ nearDays: z.coerce.number().int().min(0).max(15).default(3) }).parse(req.query);

    const stmt = await repo.findStatement(id, ctx.tenantId);
    if (!stmt) throw new HttpError(404, "NOT_FOUND", "statement not found");

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await commands.reconcileStatement(ctx, id, q.nearDays),
    );
  });

  // ── BRS: matched + unreconciled-in-books + unreconciled-in-bank ──
  app.get("/v1/finance/bank-statements/:id/brs", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const stmt = await repo.findStatement(id, ctx.tenantId);
    if (!stmt) throw new HttpError(404, "NOT_FOUND", "statement not found");

    const lines = await repo.allLines(id);
    const matched = lines.filter((l) => l.matched);
    const unreconciledInBank = lines.filter((l) => !l.matched);

    // book side still unreconciled (H2: scoped to this statement's bank account)
    const payments = await repo.unreconciledPayments(ctx.tenantId, stmt.bankAccountId);
    const challans = await repo.unreconciledChallans(ctx.tenantId, stmt.bankAccountId);

    const signed = (l: typeof lines[number]) => (l.direction === "credit" ? l.amountMinor : -l.amountMinor);

    const matchedNetMinor = matched.reduce((s, l) => s + signed(l), 0n);
    const unreconciledBankNetMinor = unreconciledInBank.reduce((s, l) => s + signed(l), 0n);
    // book side: payments reduce balance (money out), receipts increase
    const unreconciledBooksPaymentsMinor = payments.reduce((s, p) => s + p.amountMinor, 0n);
    const unreconciledBooksReceiptsMinor = challans.reduce((s, c) => s + c.amountMinor, 0n);

    // Reconciled (per-book) balance = opening + matched net movement
    const reconciledBalanceMinor = stmt.openingMinor + matchedNetMinor;
    // Statement closing reconciliation difference
    const statementClosingMinor = stmt.closingMinor;
    const differenceMinor = statementClosingMinor - (reconciledBalanceMinor + unreconciledBankNetMinor);

    return reply.send({
      data: {
        statementId: id,
        openingMinor: stmt.openingMinor.toString(),
        statementClosingMinor: statementClosingMinor.toString(),
        reconciledBalanceMinor: reconciledBalanceMinor.toString(),
        differenceMinor: differenceMinor.toString(),
        isReconciled: differenceMinor === 0n,
        matched: matched.map((l) => ({
          lineId: l.id, lineDate: l.lineDate, amountMinor: l.amountMinor.toString(),
          direction: l.direction, reference: l.reference, matchType: l.matchType, matchId: l.matchId,
        })),
        unreconciledInBank: unreconciledInBank.map((l) => ({
          lineId: l.id, lineDate: l.lineDate, amountMinor: l.amountMinor.toString(),
          direction: l.direction, reference: l.reference, narration: l.narration,
        })),
        unreconciledInBooks: {
          payments: payments.map((p) => ({ id: p.id, amountMinor: p.amountMinor.toString(), date: p.date, reference: p.reference })),
          receipts: challans.map((c) => ({ id: c.id, amountMinor: c.amountMinor.toString(), date: c.date, reference: c.reference })),
          totalPaymentsMinor: unreconciledBooksPaymentsMinor.toString(),
          totalReceiptsMinor: unreconciledBooksReceiptsMinor.toString(),
        },
      },
    });
  });

  app.get("/v1/finance/bank-statements", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    const rows = await repo.listStatements(ctx.tenantId, q.limit);
    return reply.send({ data: rows });
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
