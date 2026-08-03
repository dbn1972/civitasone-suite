/**
 * Generic numbering & reference-generation API (CAP-032).
 *
 *   POST   /v1/metadata/number-formats                 — define a format (draft)
 *   GET    /v1/metadata/number-formats                 — list
 *   GET    /v1/metadata/number-formats/:id             — get
 *   PATCH  /v1/metadata/number-formats/:id             — update (draft only)
 *   POST   /v1/metadata/number-formats/:id/publish     — activate (maker-checker)
 *   POST   /v1/metadata/numbers/allocate               — allocate the next reference
 *
 * Format changes are maker-checker: a format is created `draft`, and the author
 * may NOT publish (activate) their own definition — a different admin must.
 * Allocation runs against `active` formats only, gapless per (format, bucket),
 * inside the tenant-GUC transaction so RLS enforces isolation at runtime.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { withTenant } from "../../shared/scope.js";
import { registerErrorHandler } from "../../shared/errors.js";
import { ADMIN, DATA } from "../../shared/roles.js";
import { numberFormats } from "./schema.js";
import { isValidFormatKey, rowToSpec, METADATA_SEQ_CONFIG } from "./domain.js";
import { normalizeSpec, allocateReference, type SqlExecutor } from "@civitasone/numbering";
import { randomUUID } from "node:crypto";
import { publishCommand } from "../../shared/publish.js";
import { COMMANDS } from "../../topics.js";

const specFields = {
  prefix: z.string().max(32).optional(),
  embedFinancialYear: z.boolean().optional(),
  fyStartMonth: z.number().int().min(1).max(12).optional(),
  counterWidth: z.number().int().min(1).max(18).optional(),
  separator: z.string().max(4).optional(),
  resetPolicy: z.enum(["never", "yearly", "monthly"]).optional(),
};

/** Reject a spec that the shared normaliser considers invalid (400, not 500). */
function assertValidSpec(input: Record<string, unknown>): void {
  try {
    normalizeSpec(input);
  } catch (err) {
    throw new HttpError(400, "NUMBER_FORMAT_INVALID", err instanceof Error ? err.message : "invalid format spec");
  }
}

export async function numberingRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/metadata/number-formats", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const body = z.object({
      formatKey: z.string().min(3).max(128),
      label: z.string().min(1).max(256),
      ...specFields,
    }).parse(req.body);
    if (!isValidFormatKey(body.formatKey)) {
      throw new HttpError(400, "FORMAT_KEY_INVALID", "formatKey must be dotted lowercase, e.g. 'procurement.po'");
    }
    const spec = normalizeSpec(body);

    const id = randomUUID();
    return reply.code(202).send({
      data: await publishCommand(ctx, COMMANDS.NUMBER_FORMAT_CREATE, id, {
        formatKey: body.formatKey,
        label: body.label,
        prefix: spec.prefix,
        embedFinancialYear: spec.embedFinancialYear,
        fyStartMonth: spec.fyStartMonth,
        counterWidth: spec.counterWidth,
        separator: spec.separator,
        resetPolicy: spec.resetPolicy,
      }),
    });
  });

  app.get("/v1/metadata/number-formats", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const rows = await withTenant(ctx.tenantId, (tx) =>
      tx.select().from(numberFormats).where(eq(numberFormats.tenantId, ctx.tenantId)),
    );
    return reply.send({ data: rows, meta: { total: rows.length } });
  });

  app.get("/v1/metadata/number-formats/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const rows = await withTenant(ctx.tenantId, (tx) =>
      tx.select().from(numberFormats).where(and(eq(numberFormats.id, id), eq(numberFormats.tenantId, ctx.tenantId))).limit(1),
    );
    if (!rows[0]) throw new HttpError(404, "NOT_FOUND", "Number format not found");
    return reply.send({ data: rows[0] });
  });

  app.patch("/v1/metadata/number-formats/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ label: z.string().min(1).max(256).optional(), ...specFields }).parse(req.body);

    const patch: Record<string, unknown> = {};
    await withTenant(ctx.tenantId, async (tx) => {
      const existing = await tx.select().from(numberFormats)
        .where(and(eq(numberFormats.id, id), eq(numberFormats.tenantId, ctx.tenantId))).limit(1);
      if (!existing[0]) throw new HttpError(404, "NOT_FOUND", "Number format not found");
      if (existing[0].status !== "draft") {
        throw new HttpError(409, "FORMAT_NOT_DRAFT", "only draft formats can be edited; publish creates an immutable active format");
      }
      const merged = {
        prefix: body.prefix ?? existing[0].prefix,
        embedFinancialYear: body.embedFinancialYear ?? existing[0].embedFinancialYear,
        fyStartMonth: body.fyStartMonth ?? existing[0].fyStartMonth,
        counterWidth: body.counterWidth ?? existing[0].counterWidth,
        separator: body.separator ?? existing[0].separator,
        resetPolicy: (body.resetPolicy ?? existing[0].resetPolicy) as string,
      };
      assertValidSpec(merged);
      if (body.label !== undefined) patch.label = body.label;
      for (const k of ["prefix", "embedFinancialYear", "fyStartMonth", "counterWidth", "separator", "resetPolicy"] as const) {
        if (body[k] !== undefined) patch[k] = body[k];
      }
    });
    return reply.code(202).send({ data: await publishCommand(ctx, COMMANDS.NUMBER_FORMAT_UPDATE, id, patch) });
  });

  app.post("/v1/metadata/number-formats/:id/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    await withTenant(ctx.tenantId, async (tx) => {
      const existing = await tx.select().from(numberFormats)
        .where(and(eq(numberFormats.id, id), eq(numberFormats.tenantId, ctx.tenantId))).limit(1);
      if (!existing[0]) throw new HttpError(404, "NOT_FOUND", "Number format not found");
      if (existing[0].status === "active") throw new HttpError(409, "ALREADY_ACTIVE", "Number format is already active");
      if (existing[0].createdBy === ctx.actorId) {
        throw new HttpError(403, "MAKER_CANNOT_CHECK", "the format's author cannot publish it — a different admin must approve");
      }
      rowToSpec(existing[0]);
    });
    return reply.code(202).send({ data: await publishCommand(ctx, COMMANDS.NUMBER_FORMAT_PUBLISH, id, {}) });
  });

  app.post("/v1/metadata/numbers/allocate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, DATA);
    const body = z.object({
      formatKey: z.string().min(3).max(128),
      at: z.string().datetime().optional(),
    }).parse(req.body);
    const at = body.at ? new Date(body.at) : new Date();

    const result = await withTenant(ctx.tenantId, async (tx) => {
      const rows = await tx.select().from(numberFormats)
        .where(and(eq(numberFormats.formatKey, body.formatKey), eq(numberFormats.tenantId, ctx.tenantId))).limit(1);
      const fmt = rows[0];
      if (!fmt) throw new HttpError(404, "FORMAT_NOT_FOUND", `no number format '${body.formatKey}' for tenant`);
      if (fmt.status !== "active") throw new HttpError(409, "FORMAT_NOT_ACTIVE", `number format '${body.formatKey}' is not active`);
      return allocateReference(tx as unknown as SqlExecutor, {
        spec: rowToSpec(fmt),
        seqConfig: METADATA_SEQ_CONFIG,
        formatKey: body.formatKey,
        tenantId: ctx.tenantId,
        at,
      });
    });
    return reply.code(201).send({
      data: { formatKey: body.formatKey, reference: result.reference, sequence: result.sequence.toString(), bucket: result.bucket },
    });
  });

  registerErrorHandler(app);
}
