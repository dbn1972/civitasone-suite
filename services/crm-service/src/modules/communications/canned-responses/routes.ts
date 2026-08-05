/**
 * Gap 5 — CRUD routes for canned responses (quick-reply templates for agents).
 *
 * POST   /v1/crm/canned-responses      — create
 * GET    /v1/crm/canned-responses      — list (search/filter)
 * GET    /v1/crm/canned-responses/:id  — get by id
 * PATCH  /v1/crm/canned-responses/:id  — update
 * DELETE /v1/crm/canned-responses/:id  — remove
 */
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../../shared/context.js";
import { scopedRead } from "../../../shared/db.js";
import {
  createCannedResponseBody,
  updateCannedResponseBody,
  cannedResponseIdParam,
  cannedResponseListQuery,
} from "./validators.js";

const ROLES = ["crm_user", "crm_admin", "super_admin"];

interface CannedResponseRow {
  id: string;
  tenantId: string;
  title: string;
  body: string;
  channel: string;
  category: string | null;
  shortcutKey: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export async function cannedResponseRoutes(app: FastifyInstance): Promise<void> {
  // Create
  app.post("/v1/crm/canned-responses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const body = createCannedResponseBody.parse(req.body);

    const id = randomUUID();
    await scopedRead(async (tx) => {
      await tx.execute(sql`
        INSERT INTO crm.canned_responses (id, tenant_id, title, body, channel, category, shortcut_key, created_by)
        VALUES (${id}, ${ctx.tenantId}, ${body.title}, ${body.body}, ${body.channel},
                ${body.category ?? null}, ${body.shortcutKey ?? null}, ${ctx.actorId})
      `);
    });

    return reply.code(201).send({ data: { id } });
  });

  // List with optional search/filter
  app.get("/v1/crm/canned-responses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const query = cannedResponseListQuery.parse(req.query);

    const conditions = [sql`tenant_id = ${ctx.tenantId}`];
    if (query.category) conditions.push(sql`category = ${query.category}`);
    if (query.channel) conditions.push(sql`channel = ${query.channel}`);
    if (query.search) conditions.push(sql`(title ILIKE ${"%" + query.search + "%"} OR body ILIKE ${"%" + query.search + "%"})`);

    const where = sql.join(conditions, sql` AND `);
    const rows = await scopedRead((tx) => tx.execute(sql`
      SELECT id, tenant_id AS "tenantId", title, body, channel, category,
             shortcut_key AS "shortcutKey", created_by AS "createdBy",
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM crm.canned_responses
      WHERE ${where}
      ORDER BY title ASC
      LIMIT 200
    `)) as unknown as CannedResponseRow[];

    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  // Get by ID
  app.get("/v1/crm/canned-responses/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = cannedResponseIdParam.parse(req.params);

    const rows = await scopedRead((tx) => tx.execute(sql`
      SELECT id, tenant_id AS "tenantId", title, body, channel, category,
             shortcut_key AS "shortcutKey", created_by AS "createdBy",
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM crm.canned_responses
      WHERE tenant_id = ${ctx.tenantId} AND id = ${id}
      LIMIT 1
    `)) as unknown as CannedResponseRow[];

    if (!rows[0]) throw new HttpError(404, "NOT_FOUND", "canned response not found");
    return reply.send({ data: rows[0] });
  });

  // Update
  app.patch("/v1/crm/canned-responses/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = cannedResponseIdParam.parse(req.params);
    const body = updateCannedResponseBody.parse(req.body);

    const sets: ReturnType<typeof sql>[] = [sql`updated_at = now()`, sql`updated_by = ${ctx.actorId}`];
    if (body.title !== undefined) sets.push(sql`title = ${body.title}`);
    if (body.body !== undefined) sets.push(sql`body = ${body.body}`);
    if (body.channel !== undefined) sets.push(sql`channel = ${body.channel}`);
    if (body.category !== undefined) sets.push(sql`category = ${body.category}`);
    if (body.shortcutKey !== undefined) sets.push(sql`shortcut_key = ${body.shortcutKey}`);

    const setClauses = sql.join(sets, sql`, `);
    const result = await scopedRead(async (tx) => {
      return tx.execute(sql`
        UPDATE crm.canned_responses
        SET ${setClauses}
        WHERE tenant_id = ${ctx.tenantId} AND id = ${id}
        RETURNING id
      `);
    }) as unknown as Array<{ id: string }>;

    if (!result[0]) throw new HttpError(404, "NOT_FOUND", "canned response not found");
    return reply.send({ data: { id } });
  });

  // Delete
  app.delete("/v1/crm/canned-responses/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { id } = cannedResponseIdParam.parse(req.params);

    const result = await scopedRead(async (tx) => {
      return tx.execute(sql`
        DELETE FROM crm.canned_responses
        WHERE tenant_id = ${ctx.tenantId} AND id = ${id}
        RETURNING id
      `);
    }) as unknown as Array<{ id: string }>;

    if (!result[0]) throw new HttpError(404, "NOT_FOUND", "canned response not found");
    return reply.code(204).send();
  });
}
