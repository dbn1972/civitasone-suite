/**
 * Shared CQRS plumbing for the small per-tenant "code master" admin tables
 * (service types, grievance categories): code + label + active + sort_order.
 *
 * Route (read-only SQL + zod + role gate) -> command (randomUUID id, 202) ->
 * consumer (markProcessed, tenant-scoped write + audit.event.record in ONE
 * transaction). Route files never write the DB (t2-02 / f3 CQRS scan).
 */
import type { FastifyInstance } from "fastify";
import type { Queue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { ZodError, z } from "zod";
import { sql } from "drizzle-orm";
import { db, scopedRead } from "./db.js";
import { enqueue, markProcessed } from "./outbox.js";
import { resolveContext, requireRole, HttpError } from "./context.js";
import { publishCrmCommand } from "./residual-publish.js";

const CRM_ROLES = ["crm_user", "crm_admin", "super_admin", "tenant_admin"];
const ADMIN_ROLES = ["crm_admin", "tenant_admin", "super_admin"];
const AUDIT = "audit.event.record";

const SELECT_COLS = sql`
  id, code, label, active, sort_order AS "sortOrder",
  created_at AS "createdAt", updated_at AS "updatedAt", version`;

const createBody = z.object({
  code: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/, "code must be lowercase snake_case"),
  label: z.string().min(1).max(160),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});
const updateBody = z
  .object({
    label: z.string().min(1).max(160).optional(),
    active: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "no fields to update" });
const idParam = z.object({ id: z.string().uuid() });

export interface CodeMasterConfig {
  /** Plural REST segment, e.g. "service-types". */
  path: string;
  /** Fully qualified table, e.g. "crm.service_types" (static, never user input). */
  table: "crm.service_types" | "crm.grievance_categories";
  /** Audit resource type / action prefix, e.g. "service_type". */
  resource: string;
  /** Human noun for error messages, e.g. "service type". */
  noun: string;
  commands: { create: string; update: string; remove: string };
}

export async function registerCodeMasterRoutes(app: FastifyInstance, cfg: CodeMasterConfig): Promise<void> {
  const base = `/v1/crm/${cfg.path}`;
  const tbl = sql.raw(cfg.table);

  app.get(base, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, CRM_ROLES);
    const rows = (await scopedRead((tx) => tx.execute(sql`
      SELECT ${SELECT_COLS} FROM ${tbl}
      WHERE tenant_id = ${ctx.tenantId} ORDER BY sort_order, label
    `))) as unknown as Array<Record<string, unknown>>;
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  app.post(base, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const b = createBody.parse(req.body);
    const dup = (await scopedRead((tx) => tx.execute(sql`
      SELECT 1 FROM ${tbl} WHERE tenant_id = ${ctx.tenantId} AND code = ${b.code}
    `))) as unknown as unknown[];
    if (dup.length > 0) throw new HttpError(409, "CONFLICT", `a ${cfg.noun} with this code already exists`);
    const accepted = await publishCrmCommand(ctx, cfg.commands.create, randomUUID(), { ...b });
    return reply.code(202).send(accepted);
  });

  app.put(`${base}/:id`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const b = updateBody.parse(req.body);
    await assertExists(tbl, ctx.tenantId, id, cfg.noun);
    // `id` is the target row; a fresh messageId is derived per request/idempotency key.
    const accepted = await publishCrmCommand(ctx, cfg.commands.update, id, { ...b });
    return reply.code(202).send(accepted);
  });

  app.delete(`${base}/:id`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    await assertExists(tbl, ctx.tenantId, id, cfg.noun);
    const accepted = await publishCrmCommand(ctx, cfg.commands.remove, id, {});
    return reply.code(202).send(accepted);
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}

async function assertExists(tbl: ReturnType<typeof sql.raw>, tenantId: string, id: string, noun: string): Promise<void> {
  const rows = (await scopedRead((tx) => tx.execute(sql`
    SELECT 1 FROM ${tbl} WHERE id = ${id} AND tenant_id = ${tenantId}
  `))) as unknown as unknown[];
  if (rows.length === 0) throw new HttpError(404, "NOT_FOUND", `${noun} not found`);
}

interface Msg {
  messageId: string;
  tenantId: string;
  actorId: string;
  correlationId: string;
  payload: unknown;
}

export function registerCodeMasterConsumers(queue: Queue, cfg: CodeMasterConfig): void {
  const tbl = sql.raw(cfg.table);
  const audit = (tx: Parameters<typeof enqueue>[0], m: Msg, verb: string, resourceId: string) =>
    enqueue(tx, {
      topic: AUDIT, eventType: AUDIT, tenantId: m.tenantId, actorId: m.actorId, correlationId: m.correlationId,
      payload: { service: "crm", action: `${cfg.resource}_${verb}`, resourceType: cfg.resource, resourceId, outcome: "success" },
    });

  queue.subscribe(cfg.commands.create, async (msg) => {
    const m = msg as unknown as Msg;
    const p = m.payload as { id: string } & z.infer<typeof createBody>;
    if (!p?.id) return;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, m.messageId))) return;
      const inserted = (await tx.execute(sql`
        INSERT INTO ${tbl} (id, tenant_id, code, label, active, sort_order, created_by, updated_by)
        VALUES (${p.id}, ${m.tenantId}, ${p.code}, ${p.label}, ${p.active}, ${p.sortOrder}, ${m.actorId}, ${m.actorId})
        ON CONFLICT (tenant_id, code) DO NOTHING
        RETURNING id
      `)) as unknown as unknown[];
      if (inserted.length === 0) return; // lost a create race: nothing written, nothing audited
      await audit(tx, m, "create", p.id);
    });
  });

  queue.subscribe(cfg.commands.update, async (msg) => {
    const m = msg as unknown as Msg;
    const p = m.payload as { id: string } & z.infer<typeof updateBody>;
    if (!p?.id) return;
    const sets = [] as ReturnType<typeof sql>[];
    if (p.label !== undefined) sets.push(sql`label = ${p.label}`);
    if (p.active !== undefined) sets.push(sql`active = ${p.active}`);
    if (p.sortOrder !== undefined) sets.push(sql`sort_order = ${p.sortOrder}`);
    sets.push(sql`updated_at = now()`, sql`updated_by = ${m.actorId}`, sql`version = version + 1`);
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, m.messageId))) return;
      const updated = (await tx.execute(sql`
        UPDATE ${tbl} SET ${sql.join(sets, sql`, `)}
        WHERE id = ${p.id} AND tenant_id = ${m.tenantId}
        RETURNING id
      `)) as unknown as unknown[];
      if (updated.length === 0) return;
      await audit(tx, m, "update", p.id);
    });
  });

  queue.subscribe(cfg.commands.remove, async (msg) => {
    const m = msg as unknown as Msg;
    const p = m.payload as { id: string };
    if (!p?.id) return;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, m.messageId))) return;
      const rows = (await tx.execute(sql`
        DELETE FROM ${tbl} WHERE id = ${p.id} AND tenant_id = ${m.tenantId} RETURNING id
      `)) as unknown as unknown[];
      if (rows.length === 0) return;
      await audit(tx, m, "delete", p.id);
    });
  });
}
