/**
 * Policies module — HTTP routes (Fastify plugin).
 * CRUD + versions + lifecycle (publish/archive) + acknowledgment + compliance-status.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, readScoped } from "../../shared/db.js";
import { policies, policyVersions, policyAcknowledgments } from "./schema.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];

function safeParse<O>(schema: z.ZodType<O, z.ZodTypeDef, unknown>, data: unknown): O {
  const result = schema.safeParse(data);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new HttpError(400, "VALIDATION_FAILED", msg);
  }
  return result.data;
}

const createPolicyBody = z.object({
  title:         z.string().min(1).max(512),
  slug:          z.string().min(1).max(256).regex(/^[a-z0-9-]+$/),
  category:      z.string().max(128).default("general"),
  tags:          z.array(z.string().max(64)).default([]),
  content:       z.string().default(""),
  ownerId:       z.string().uuid().optional(),
  effectiveFrom: z.string().datetime().optional(),
  effectiveTo:   z.string().datetime().optional(),
});

const updatePolicyBody = createPolicyBody.partial();
const policyIdParam   = z.object({ id: z.string().uuid() });
const ackBody         = z.object({ ipAddress: z.string().max(64).optional() });

export async function policyDocRoutes(app: FastifyInstance): Promise<void> {
  // LIST
  app.get("/v1/policy/policies", async (req, reply) => {
    const ctx = resolveContext(req);
    const rows = await readScoped(ctx.tenantId, (tx) =>
      tx.select().from(policies)
        .where(eq(policies.tenantId, ctx.tenantId))
        .orderBy(desc(policies.updatedAt)),
    );
    return reply.send({ data: rows });
  });

  // CREATE
  app.post("/v1/policy/policies", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = safeParse(createPolicyBody, req.body);
    const id = randomUUID();
    await runWithTenant(ctx.tenantId, () =>
      db.transaction(async (tx) => {
        await tx.insert(policies).values({
          id,
          tenantId:      ctx.tenantId,
          title:         body.title,
          slug:          body.slug,
          category:      body.category,
          tags:          body.tags,
          content:       body.content,
          ownerId:       body.ownerId ?? null,
          effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : null,
          effectiveTo:   body.effectiveTo   ? new Date(body.effectiveTo)   : null,
          createdBy:     ctx.actorId,
          updatedBy:     ctx.actorId,
        });
        await tx.insert(policyVersions).values({
          id:         randomUUID(),
          policyId:   id,
          tenantId:   ctx.tenantId,
          versionNum: 1,
          content:    body.content,
          status:     "draft",
          createdBy:  ctx.actorId,
        });
      }),
    );
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });

  // GET by ID
  app.get("/v1/policy/policies/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = safeParse(policyIdParam, req.params);
    const [row] = await readScoped(ctx.tenantId, (tx) =>
      tx.select().from(policies).where(and(eq(policies.id, id), eq(policies.tenantId, ctx.tenantId))),
    );
    if (!row) throw new HttpError(404, "NOT_FOUND", "policy not found");
    return reply.send(row);
  });

  // PATCH
  app.patch("/v1/policy/policies/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = safeParse(policyIdParam, req.params);
    const body = safeParse(updatePolicyBody, req.body);
    await runWithTenant(ctx.tenantId, () =>
      db.transaction(async (tx) => {
        const [existing] = await tx.select().from(policies)
          .where(and(eq(policies.id, id), eq(policies.tenantId, ctx.tenantId)));
        if (!existing) throw new HttpError(404, "NOT_FOUND", "policy not found");
        const newVersion = existing.version + 1;
        await tx.update(policies).set({
          ...(body.title     !== undefined && { title:     body.title }),
          ...(body.slug      !== undefined && { slug:      body.slug }),
          ...(body.category  !== undefined && { category:  body.category }),
          ...(body.tags      !== undefined && { tags:      body.tags }),
          ...(body.content   !== undefined && { content:   body.content }),
          ...(body.ownerId   !== undefined && { ownerId:   body.ownerId }),
          effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : existing.effectiveFrom,
          effectiveTo:   body.effectiveTo   ? new Date(body.effectiveTo)   : existing.effectiveTo,
          version:    newVersion,
          updatedAt:  new Date(),
          updatedBy:  ctx.actorId,
        }).where(eq(policies.id, id));
        if (body.content !== undefined) {
          await tx.insert(policyVersions).values({
            id: randomUUID(), policyId: id, tenantId: ctx.tenantId,
            versionNum: newVersion, content: body.content ?? existing.content,
            status: existing.status, createdBy: ctx.actorId,
          });
        }
      }),
    );
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });

  // GET VERSIONS
  app.get("/v1/policy/policies/:id/versions", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = safeParse(policyIdParam, req.params);
    const rows = await readScoped(ctx.tenantId, (tx) =>
      tx.select().from(policyVersions)
        .where(and(eq(policyVersions.policyId, id), eq(policyVersions.tenantId, ctx.tenantId)))
        .orderBy(desc(policyVersions.versionNum)),
    );
    return reply.send({ data: rows });
  });

  // PUBLISH
  app.post("/v1/policy/policies/:id/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = safeParse(policyIdParam, req.params);
    await runWithTenant(ctx.tenantId, () =>
      db.transaction(async (tx) => {
        const [existing] = await tx.select().from(policies)
          .where(and(eq(policies.id, id), eq(policies.tenantId, ctx.tenantId)));
        if (!existing) throw new HttpError(404, "NOT_FOUND", "policy not found");
        if (existing.status === "archived") throw new HttpError(409, "CONFLICT", "cannot publish archived policy");
        await tx.update(policies).set({
          status: "published", publishedAt: new Date(), updatedAt: new Date(), updatedBy: ctx.actorId,
        }).where(eq(policies.id, id));
      }),
    );
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });

  // ARCHIVE
  app.post("/v1/policy/policies/:id/archive", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = safeParse(policyIdParam, req.params);
    await runWithTenant(ctx.tenantId, () =>
      db.transaction(async (tx) => {
        const [existing] = await tx.select().from(policies)
          .where(and(eq(policies.id, id), eq(policies.tenantId, ctx.tenantId)));
        if (!existing) throw new HttpError(404, "NOT_FOUND", "policy not found");
        await tx.update(policies).set({
          status: "archived", archivedAt: new Date(), updatedAt: new Date(), updatedBy: ctx.actorId,
        }).where(eq(policies.id, id));
      }),
    );
    return reply.code(202).send({ id, status: "accepted", correlationId: ctx.correlationId });
  });

  // ACKNOWLEDGE
  app.post("/v1/policy/policies/:id/acknowledge", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = safeParse(policyIdParam, req.params);
    const body = safeParse(ackBody, req.body ?? {});
    await runWithTenant(ctx.tenantId, () =>
      db.transaction(async (tx) => {
        const [existing] = await tx.select().from(policies)
          .where(and(eq(policies.id, id), eq(policies.tenantId, ctx.tenantId)));
        if (!existing) throw new HttpError(404, "NOT_FOUND", "policy not found");
        if (existing.status !== "published") throw new HttpError(409, "CONFLICT", "can only acknowledge published policies");
        await tx.insert(policyAcknowledgments).values({
          id: randomUUID(), policyId: id, tenantId: ctx.tenantId,
          userId: ctx.actorId, ipAddress: body.ipAddress ?? null,
        }).onConflictDoUpdate({ target: [policyAcknowledgments.policyId, policyAcknowledgments.userId], set: { ackedAt: new Date() } });
      }),
    );
    return reply.code(202).send({ status: "acknowledged", correlationId: ctx.correlationId });
  });

  // COMPLIANCE STATUS — summary of who has/hasn't acknowledged published policies
  app.get("/v1/policy/compliance-status", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const rows = await readScoped(ctx.tenantId, async (tx) => {
      const pols = await tx.select({
        id: policies.id, title: policies.title, slug: policies.slug,
        status: policies.status, publishedAt: policies.publishedAt,
      }).from(policies)
        .where(and(eq(policies.tenantId, ctx.tenantId), eq(policies.status, "published")));
      const acks = await tx.select().from(policyAcknowledgments)
        .where(eq(policyAcknowledgments.tenantId, ctx.tenantId));
      return pols.map((p) => ({
        ...p,
        acknowledgmentCount: acks.filter((a) => a.policyId === p.id).length,
      }));
    });
    return reply.send({ data: rows });
  });
}
