import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];

/**
 * GAP2-FINANCE-RECURRING-ENTRIES-08: the wire contract for GET
 * /v1/finance/recurring-entries. Only the fields the UI consumes — the
 * internal debit/credit account UUIDs and created_by are deliberately NOT
 * exposed, and the payload is validated by this schema before it is sent, so a
 * column rename can no longer silently change the API shape (mirrors
 * budget/routes.ts's sendValidated(FinanceDemandSummaryListSchema, …)).
 */
export const RecurringEntryListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  voucherType: z.string(),
  frequency: z.string(),
  amountMinor: z.string(),
  nextRunDate: z.string().nullable(),
  endDate: z.string().nullable(),
  isActive: z.boolean(),
});
export const RecurringEntryListResponseSchema = z.object({ data: z.array(RecurringEntryListItemSchema) });

/** A date-ish DB value (string | Date | null) rendered as YYYY-MM-DD or null. */
function toDateString(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/** Map a raw snake_case row to the camelCase wire contract (drops account UUIDs / created_by). */
export function serializeRecurringEntry(row: Record<string, unknown>): z.infer<typeof RecurringEntryListItemSchema> {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    voucherType: String(row.voucher_type ?? "journal"),
    frequency: String(row.frequency ?? ""),
    amountMinor: String(row.amount_minor ?? "0"),
    nextRunDate: toDateString(row.next_run_date),
    endDate: toDateString(row.end_date),
    isActive: Boolean(row.is_active),
  };
}

/**
 * Voucher types a template may carry (GAP-FINANCE-RECURRING-ENTRIES-04): the
 * natures allowed by the cashbook voucher_type CHECK (migration 0009). "transfer"
 * is deliberately absent -- the CHECK rejects it.
 */
export const RECURRING_VOUCHER_TYPES = ["journal", "payment", "receipt", "contra", "debit_note", "credit_note"] as const;

/** Today's calendar date in Asia/Kolkata as YYYY-MM-DD (the date a clerk means by "today"). */
export function todayIstDate(now: number = Date.now()): string {
  return new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** POST body for a new template; a back-dated first run is rejected (GAP-FINANCE-RECURRING-ENTRIES-06). */
export const createRecurringBody = z
  .object({
    name: z.string().max(256),
    voucherType: z.enum(RECURRING_VOUCHER_TYPES).default("journal"),
    frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly"]).default("monthly"),
    debitAccountId: z.string().uuid(),
    creditAccountId: z.string().uuid(),
    amountMinor: z.number().int().positive(),
    narration: z.string().optional(),
    nextRunDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.nextRunDate < todayIstDate()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nextRunDate"], message: "nextRunDate cannot be in the past" });
    }
    if (v.endDate && v.endDate < v.nextRunDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "endDate cannot be before nextRunDate" });
    }
  });

export async function recurringRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/finance/recurring-entries", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    const q = z.object({
      active: z.coerce.boolean().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    const rows = await scopedRead((tx) => tx.execute(sql`
      SELECT id, name, voucher_type, frequency, amount_minor, next_run_date, end_date, is_active
      FROM gl.finance_recurring_entries
      WHERE tenant_id = ${ctx.tenantId}::uuid
        AND (${q.active ?? null}::boolean IS NULL OR is_active = ${q.active ?? null})
      ORDER BY next_run_date ASC
      LIMIT ${q.limit} OFFSET ${q.offset}
    `));

    // GAP2-FINANCE-RECURRING-ENTRIES-08: serialize to the camelCase wire
    // contract (no debit_account_id/credit_account_id/created_by) and validate
    // the response before sending.
    return sendValidated(reply, RecurringEntryListResponseSchema, {
      data: (rows as Record<string, unknown>[]).map(serializeRecurringEntry),
    });
  });

  app.post("/v1/finance/recurring-entries", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    const body = createRecurringBody.parse(req.body);

    const id = randomUUID();
    await queue.publish(COMMANDS.recurringEntryCreate, {
      messageId: id, type: COMMANDS.recurringEntryCreate,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: {
        id, tenantId: ctx.tenantId, name: body.name, voucherType: body.voucherType,
        frequency: body.frequency, debitAccountId: body.debitAccountId,
        creditAccountId: body.creditAccountId, amountMinor: body.amountMinor,
        narration: body.narration, nextRunDate: body.nextRunDate, endDate: body.endDate,
      },
    });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });

  app.patch("/v1/finance/recurring-entries/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({
      name: z.string().max(256).optional(),
      frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly"]).optional(),
      amountMinor: z.number().int().positive().optional(),
      narration: z.string().optional(),
      nextRunDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      isActive: z.boolean().optional(),
    }).parse(req.body);

    if (
      body.name === undefined && body.frequency === undefined && body.amountMinor === undefined &&
      body.narration === undefined && body.nextRunDate === undefined &&
      body.endDate === undefined && body.isActive === undefined
    ) {
      throw new HttpError(400, "NO_CHANGES", "no fields provided to update");
    }

    const messageId = randomUUID();
    await queue.publish(COMMANDS.recurringEntryUpdate, {
      messageId, type: COMMANDS.recurringEntryUpdate,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { id, tenantId: ctx.tenantId, ...body },
    });
    return reply.code(202).send({ data: { id, status: "accepted" } });
  });
}
