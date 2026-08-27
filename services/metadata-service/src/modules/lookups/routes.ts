/**
 * Lookups module — KV store, lookup tables, enums, schemas endpoint.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, readScoped } from "../../shared/db.js";
import { kvStore, lookupTables, lookupValues, enumDefinitions } from "./schema.js";

import { eq, and } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];

function safeParse<O>(schema: z.ZodType<O, z.ZodTypeDef, unknown>, data: unknown): O {
  const result = schema.safeParse(data);
  if (!result.success) throw new HttpError(400, "VALIDATION_FAILED", result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return result.data;
}

const kvGetQuery    = z.object({ ns: z.string().default("default"), k: z.string().optional() });
const kvWriteBody   = z.object({ ns: z.string().default("default"), k: z.string().min(1).max(512), v: z.unknown() });
const lookupBody    = z.object({ code: z.string().min(1).max(128), label: z.string().min(1).max(256), description: z.string().optional() });
const lookupValBody = z.object({ valueCode: z.string().min(1).max(128), label: z.string().min(1).max(256), sortOrder: z.number().int().default(0) });
const enumBody      = z.object({ name: z.string().min(1).max(128), values: z.array(z.string()) });
const lookupCodeP   = z.object({ code: z.string() });
const enumNameP     = z.object({ name: z.string() });
const entityTypeP   = z.object({ entityType: z.string(), entityId: z.string().uuid() });

export async function lookupsRoutes(app: FastifyInstance): Promise<void> {
  // ── KV STORE ──────────────────────────────────────────────────────────

  app.get("/v1/metadata/kv", async (req, reply) => {
    const ctx  = resolveContext(req);
    const q    = safeParse(kvGetQuery, req.query);
    const rows = await readScoped(ctx.tenantId, (tx) => {
      const base = tx.select().from(kvStore).where(
        and(eq(kvStore.tenantId, ctx.tenantId), eq(kvStore.ns, q.ns)),
      );
      return base;
    });
    const filtered = q.k ? rows.filter((r) => r.k === q.k) : rows;
    return reply.send({ data: filtered });
  });

  app.post("/v1/metadata/kv", async (req, reply) => {
    const ctx  = resolveContext(req);
    // Deep-verify audit: every other write in this file (lookups, lookup
    // values, enums) requires ADMIN; this one and the generic entity-metadata
    // POST below did not, letting any authenticated tenant member of any role
    // write/overwrite arbitrary namespaced key-value data. Matching this
    // file's own convention rather than leaving writes open by omission.
    requireRole(ctx, ADMIN);
    const body = safeParse(kvWriteBody, req.body);
    const id   = randomUUID();
    await runWithTenant(ctx.tenantId, () =>
      db.transaction((tx) =>
        tx.insert(kvStore).values({
          id, tenantId: ctx.tenantId, ns: body.ns, k: body.k, v: body.v as object,
          createdBy: ctx.actorId,
        }).onConflictDoUpdate({
          target: [kvStore.tenantId, kvStore.ns, kvStore.k],
          set: { v: body.v as object, updatedAt: new Date() },
        }),
      ),
    );
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });

  // ── LOOKUP TABLES ─────────────────────────────────────────────────────

  app.get("/v1/metadata/lookups", async (req, reply) => {
    const ctx  = resolveContext(req);
    const rows = await readScoped(ctx.tenantId, (tx) =>
      tx.select().from(lookupTables).where(eq(lookupTables.tenantId, ctx.tenantId)),
    );
    return reply.send({ data: rows });
  });

  app.post("/v1/metadata/lookups", async (req, reply) => {
    const ctx  = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = safeParse(lookupBody, req.body);
    const id   = randomUUID();
    await runWithTenant(ctx.tenantId, () =>
      db.transaction((tx) =>
        tx.insert(lookupTables).values({ id, tenantId: ctx.tenantId, code: body.code, label: body.label, description: body.description ?? null, createdBy: ctx.actorId }),
      ),
    );
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.get("/v1/metadata/lookups/:code", async (req, reply) => {
    const ctx        = resolveContext(req);
    const { code }   = safeParse(lookupCodeP, req.params);
    const [tableRow] = await readScoped(ctx.tenantId, (tx) =>
      tx.select().from(lookupTables).where(and(eq(lookupTables.tenantId, ctx.tenantId), eq(lookupTables.code, code))),
    );
    if (!tableRow) throw new HttpError(404, "NOT_FOUND", "lookup table not found");
    const vals = await readScoped(ctx.tenantId, (tx) =>
      tx.select().from(lookupValues).where(and(eq(lookupValues.lookupId, tableRow.id), eq(lookupValues.isActive, true))),
    );
    return reply.send({ ...tableRow, values: vals });
  });

  app.post("/v1/metadata/lookups/:code/values", async (req, reply) => {
    const ctx        = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { code }   = safeParse(lookupCodeP, req.params);
    const body       = safeParse(lookupValBody, req.body);
    const [tableRow] = await readScoped(ctx.tenantId, (tx) =>
      tx.select().from(lookupTables).where(and(eq(lookupTables.tenantId, ctx.tenantId), eq(lookupTables.code, code))),
    );
    if (!tableRow) throw new HttpError(404, "NOT_FOUND", "lookup table not found");
    const id = randomUUID();
    await runWithTenant(ctx.tenantId, () =>
      db.transaction((tx) =>
        tx.insert(lookupValues).values({ id, lookupId: tableRow.id, tenantId: ctx.tenantId, ...body }),
      ),
    );
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });

  // ── ENUMS ─────────────────────────────────────────────────────────────

  app.get("/v1/metadata/enums/:name", async (req, reply) => {
    const ctx        = resolveContext(req);
    const { name }   = safeParse(enumNameP, req.params);
    const [row]      = await readScoped(ctx.tenantId, (tx) =>
      tx.select().from(enumDefinitions).where(and(eq(enumDefinitions.tenantId, ctx.tenantId), eq(enumDefinitions.name, name))),
    );
    if (!row) throw new HttpError(404, "NOT_FOUND", "enum not found");
    return reply.send(row);
  });

  app.post("/v1/metadata/enums", async (req, reply) => {
    const ctx  = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = safeParse(enumBody, req.body);
    const id   = randomUUID();
    await runWithTenant(ctx.tenantId, () =>
      db.transaction((tx) =>
        tx.insert(enumDefinitions).values({
          id, tenantId: ctx.tenantId, name: body.name, values: body.values, createdBy: ctx.actorId,
        }).onConflictDoUpdate({
          target: [enumDefinitions.tenantId, enumDefinitions.name],
          set: { values: body.values, updatedAt: new Date() },
        }),
      ),
    );
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });

  // ── SCHEMAS (catalog of lookup tables + enums as metadata schema) ──────

  app.get("/v1/metadata/schemas", async (req, reply) => {
    const ctx  = resolveContext(req);
    const [lookups, enums] = await Promise.all([
      readScoped(ctx.tenantId, (tx) => tx.select().from(lookupTables).where(eq(lookupTables.tenantId, ctx.tenantId))),
      readScoped(ctx.tenantId, (tx) => tx.select().from(enumDefinitions).where(eq(enumDefinitions.tenantId, ctx.tenantId))),
    ]);
    return reply.send({ data: [...lookups.map((l) => ({ type: 'lookup', ...l })), ...enums.map((e) => ({ type: 'enum', ...e }))] });
  });

  // ── ENTITY-SPECIFIC METADATA ──────────────────────────────────────────

  app.get("/v1/metadata/:entityType/:entityId", async (req, reply) => {
    const ctx  = resolveContext(req);
    const { entityType, entityId } = safeParse(entityTypeP, req.params);
    const rows = await readScoped(ctx.tenantId, (tx) =>
      tx.select().from(kvStore).where(
        and(eq(kvStore.tenantId, ctx.tenantId), eq(kvStore.ns, `entity:${entityType}:${entityId}`)),
      ),
    );
    return reply.send({ entityType, entityId, data: rows });
  });

  app.post("/v1/metadata/:entityType/:entityId", async (req, reply) => {
    const ctx  = resolveContext(req);
    // Deep-verify audit: same gap as POST /v1/metadata/kv above — see that
    // comment. This route is the more serious of the two, since it lets a
    // caller attach/overwrite metadata against ANY entityType/entityId, not
    // just their own namespace.
    requireRole(ctx, ADMIN);
    const { entityType, entityId } = safeParse(entityTypeP, req.params);
    const body = safeParse(z.object({ k: z.string().min(1), v: z.unknown() }), req.body);
    const id   = randomUUID();
    const ns   = `entity:${entityType}:${entityId}`;
    await runWithTenant(ctx.tenantId, () =>
      db.transaction((tx) =>
        tx.insert(kvStore).values({
          id, tenantId: ctx.tenantId, ns, k: body.k, v: body.v as object, createdBy: ctx.actorId,
        }).onConflictDoUpdate({
          target: [kvStore.tenantId, kvStore.ns, kvStore.k],
          set: { v: body.v as object, updatedAt: new Date() },
        }),
      ),
    );
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });
}
