/**
 * Canned Responses — pre-written reply templates for helpdesk agents.
 *
 * GET    /v1/helpdesk/canned-responses           — list (with optional ?q= search)
 * POST   /v1/helpdesk/canned-responses           — create (202)
 * GET    /v1/helpdesk/canned-responses/:id       — get by id
 * PATCH  /v1/helpdesk/canned-responses/:id       — update (202)
 * DELETE /v1/helpdesk/canned-responses/:id       — soft-delete (202)
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { sqlClient } from "../../shared/db.js";
import { withRawTenantGuc } from "@civitasone/db";

const ADMIN_ROLES = ["helpdesk_admin", "super_admin", "admin"];
const READER_ROLES = ["helpdesk_user", "helpdesk_agent", "helpdesk_admin", "super_admin", "admin"];

function withTenantGuc<T>(tenantId: string, fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, tenantId, fn);
}

const createBody = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  category: z.string().max(64).optional(),
  shortCode: z.string().max(32).optional(),
  tags: z.array(z.string().max(64)).max(10).optional(),
});

const updateBody = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().min(1).optional(),
  category: z.string().max(64).nullable().optional(),
  shortCode: z.string().max(32).nullable().optional(),
  tags: z.array(z.string().max(64)).max(10).optional(),
  enabled: z.boolean().optional(),
}).refine((b) => Object.keys(b).length > 0, { message: "at least one field required" });

const idParam = z.object({ id: z.string().uuid() });

const searchQuery = z.object({
  q: z.string().max(200).optional(),
  category: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function cannedResponsesRoutes(app: FastifyInstance): Promise<void> {
  /** List canned responses (with optional full-text search). */
  app.get("/v1/helpdesk/canned-responses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { q, category, limit, offset } = searchQuery.parse(req.query);

    const rows = await withTenantGuc(ctx.tenantId, async (tx) => {
      if (q) {
        return tx`
          SELECT id, title, content, category, short_code, tags, enabled, created_at, updated_at
          FROM helpdesk.canned_responses
          WHERE tenant_id = ${ctx.tenantId}
            AND enabled = true
            AND (
              title ILIKE ${"%" + q + "%"}
              OR content ILIKE ${"%" + q + "%"}
              OR short_code ILIKE ${"%" + q + "%"}
            )
            ${category ? tx`AND category = ${category}` : tx``}
          ORDER BY title
          LIMIT ${limit} OFFSET ${offset}
        `;
      }
      return tx`
        SELECT id, title, content, category, short_code, tags, enabled, created_at, updated_at
        FROM helpdesk.canned_responses
        WHERE tenant_id = ${ctx.tenantId} AND enabled = true
          ${category ? tx`AND category = ${category}` : tx``}
        ORDER BY title
        LIMIT ${limit} OFFSET ${offset}
      `;
    });

    return reply.send({ data: rows, meta: { total: rows.length, limit, offset } });
  });

  /** Get a single canned response. */
  app.get("/v1/helpdesk/canned-responses/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);

    const [row] = await withTenantGuc(ctx.tenantId, (tx) => tx`
      SELECT id, title, content, category, short_code, tags, enabled, created_at, updated_at
      FROM helpdesk.canned_responses
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
    `);

    if (!row) throw new HttpError(404, "NOT_FOUND", "canned response not found");
    return reply.send({ data: row });
  });

  /** Create a canned response (wrapped in transaction for RLS). */
  app.post("/v1/helpdesk/canned-responses", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const body = createBody.parse(req.body);
    const id = randomUUID();

    await withTenantGuc(ctx.tenantId, (tx) => tx`
      INSERT INTO helpdesk.canned_responses
        (id, tenant_id, title, content, category, short_code, tags, created_by)
      VALUES (
        ${id}::uuid, ${ctx.tenantId}::uuid, ${body.title}, ${body.content},
        ${body.category ?? null}, ${body.shortCode ?? null},
        ${JSON.stringify(body.tags ?? [])}::jsonb, ${ctx.actorId}::uuid
      )
    `);

    return reply.code(201).send({ data: { id, title: body.title, status: "created" } });
  });

  /** Update a canned response. */
  app.patch("/v1/helpdesk/canned-responses/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateBody.parse(req.body);

    const [existing] = await withTenantGuc(ctx.tenantId, (tx) => tx`
      SELECT id FROM helpdesk.canned_responses WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
    `);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "canned response not found");

    // SEC-REVIEW (fresh-services sweep): this built the UPDATE by
    // string-concatenating request-body values (only `title`/`content` were
    // even quote-escaped; `category`/`shortCode` were not escaped at all)
    // into a query string run via `tx.unsafe()`. Any ADMIN_ROLES caller could
    // break out of the string via a single quote in `category`/`shortCode`
    // and inject arbitrary SQL into this UPDATE (e.g. reassign `tenant_id`
    // to move the row to another tenant, or run stacked statements — postgres
    // 'simple query' mode used by `.unsafe()` permits both). Rebuilt using
    // the same parameterized conditional-fragment style this file's own GET
    // handler already uses (`category ? tx\`AND category = ${category}\` : tx\`\``),
    // so every value is bound, never spliced into SQL text.
    await withTenantGuc(ctx.tenantId, (tx) => tx`
      UPDATE helpdesk.canned_responses
      SET
        updated_at = now()
        ${body.title !== undefined ? tx`, title = ${body.title}` : tx``}
        ${body.content !== undefined ? tx`, content = ${body.content}` : tx``}
        ${body.category !== undefined ? tx`, category = ${body.category}` : tx``}
        ${body.shortCode !== undefined ? tx`, short_code = ${body.shortCode}` : tx``}
        ${body.tags !== undefined ? tx`, tags = ${JSON.stringify(body.tags)}::jsonb` : tx``}
        ${body.enabled !== undefined ? tx`, enabled = ${body.enabled}` : tx``}
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
    `);

    return reply.send({ data: { id, status: "updated" } });
  });

  /** Soft-delete a canned response. */
  app.delete("/v1/helpdesk/canned-responses/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);

    const result = await withTenantGuc(ctx.tenantId, (tx) => tx`
      UPDATE helpdesk.canned_responses SET enabled = false, updated_at = now()
      WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND enabled = true
    `);

    if (result.count === 0) throw new HttpError(404, "NOT_FOUND", "canned response not found");
    return reply.code(204).send();
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
