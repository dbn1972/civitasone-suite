import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

const FINANCE_ROLES = ["finance_officer", "finance_admin", "super_admin"];

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
