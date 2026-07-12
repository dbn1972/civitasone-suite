import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];

export async function recurringRoutes(app: FastifyInstance): Promise<void> {
  // GET /v1/finance/recurring-entries — list standing instructions
  app.get("/v1/finance/recurring-entries", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    const q = z.object({
      active: z.coerce.boolean().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    const rows = await scopedRead((tx) => tx.execute(sql`
      SELECT id, name, voucher_type, frequency, debit_account_id, credit_account_id,
             amount_minor, narration, next_run_date, last_run_date, end_date,
             is_active, created_at, created_by
      FROM gl.finance_recurring_entries
      WHERE tenant_id = ${ctx.tenantId}::uuid
        AND (${q.active ?? null}::boolean IS NULL OR is_active = ${q.active ?? null})
      ORDER BY next_run_date ASC
      LIMIT ${q.limit} OFFSET ${q.offset}
    `));

    return reply.send({ data: rows });
  });

  // POST /v1/finance/recurring-entries — create new recurring entry
  app.post("/v1/finance/recurring-entries", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, FINANCE_ROLES);

    const body = z.object({
      name: z.string().max(256),
      voucherType: z.string().max(20).default("journal"),
      frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "yearly"]).default("monthly"),
      debitAccountId: z.string().uuid(),
      creditAccountId: z.string().uuid(),
      amountMinor: z.number().int().positive(),
      narration: z.string().optional(),
      nextRunDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).parse(req.body);

    const rows = await db.execute(sql`
      INSERT INTO gl.finance_recurring_entries (
        tenant_id, name, voucher_type, frequency, debit_account_id, credit_account_id,
        amount_minor, narration, next_run_date, end_date, created_by
      ) VALUES (
        ${ctx.tenantId}::uuid, ${body.name}, ${body.voucherType}, ${body.frequency},
        ${body.debitAccountId}::uuid, ${body.creditAccountId}::uuid,
        ${body.amountMinor}, ${body.narration ?? null},
        ${body.nextRunDate}::date, ${body.endDate ?? null}::date, ${ctx.actorId}::uuid
      )
      RETURNING id, name, frequency, amount_minor, next_run_date, is_active
    `);

    return reply.code(201).send({ data: (rows as unknown[])[0] });
  });

  // PATCH /v1/finance/recurring-entries/:id — update/deactivate
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

    // Build dynamic SET clause
    const sets: string[] = [];
    const vals: any[] = [];
    if (body.name !== undefined) sets.push("name");
    if (body.frequency !== undefined) sets.push("frequency");
    if (body.amountMinor !== undefined) sets.push("amount_minor");
    if (body.narration !== undefined) sets.push("narration");
    if (body.nextRunDate !== undefined) sets.push("next_run_date");
    if (body.endDate !== undefined) sets.push("end_date");
    if (body.isActive !== undefined) sets.push("is_active");

    if (sets.length === 0) {
      throw new HttpError(400, "NO_CHANGES", "no fields provided to update");
    }

    const rows = await db.execute(sql`
      UPDATE gl.finance_recurring_entries
      SET
        name = COALESCE(${body.name ?? null}, name),
        frequency = COALESCE(${body.frequency ?? null}, frequency),
        amount_minor = COALESCE(${body.amountMinor ?? null}::bigint, amount_minor),
        narration = COALESCE(${body.narration ?? null}, narration),
        next_run_date = COALESCE(${body.nextRunDate ?? null}::date, next_run_date),
        end_date = ${body.endDate === undefined ? sql`end_date` : body.endDate === null ? sql`NULL` : sql`${body.endDate}::date`},
        is_active = COALESCE(${body.isActive ?? null}::boolean, is_active)
      WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid
      RETURNING id, name, frequency, amount_minor, next_run_date, is_active
    `);

    const result = rows as unknown as any[];
    if (!result || result.length === 0) {
      throw new HttpError(404, "NOT_FOUND", "recurring entry not found");
    }

    return reply.send({ data: result[0] });
  });
}
