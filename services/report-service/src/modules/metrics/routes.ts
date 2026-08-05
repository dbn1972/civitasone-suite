/**
 * metrics HTTP routes — governed metric (KPI) definition catalogue.
 *
 * GET   /v1/reports/metrics                    → paginated list
 * GET   /v1/reports/metrics/:id                → single (read-through cache)
 * GET   /v1/reports/metrics/by-key/:metricKey  → currently published version for a key
 * POST  /v1/reports/metrics                    → 202 (create draft)
 * PATCH /v1/reports/metrics/:id                → 202 (optimistic-locked update)
 * POST  /v1/reports/metrics/:id/publish        → 202 (draft → published)
 * POST  /v1/reports/metrics/:id/deprecate      → 202 (published → deprecated)
 * POST  /v1/reports/metrics/:id/versions       → 202 (next versionNumber as new draft)
 *
 * Strict CQRS: no route writes Postgres. Each mutation validates and publishes a
 * command; metrics/consumer.ts performs the write.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { HttpError, requireRole, resolveContext } from "../../shared/context.js";
import * as commands from "./commands.js";
import type { MetricDefinitionProjection } from "./commands.js";
import {
  checkPatchAllowed,
  nextVersionDraft,
  validateMetricDefinition,
  validateStatusTransition,
} from "./domain.js";
import * as queries from "./queries.js";
import type { MetricFilters } from "./repo.js";
import * as repo from "./repo.js";
import {
  createMetricBody,
  idParam,
  listMetricsQuery,
  metricKeyParam,
  transitionBody,
  updateMetricBody,
} from "./validators.js";

const READ_ROLES = ["report_user", "report_admin", "super_admin", "tenant_admin"];
const WRITE_ROLES = ["report_admin", "super_admin", "tenant_admin"];

/** Domain validation failures are business-rule violations → 422. */
function assertValid(input: Parameters<typeof validateMetricDefinition>[0]): void {
  const errors = validateMetricDefinition(input);
  if (errors.length > 0) {
    throw new HttpError(
      422,
      "VALIDATION_FAILED",
      errors.map((e) => `${e.field}: ${e.message}`).join("; "),
    );
  }
}

export async function metricRoutes(app: FastifyInstance): Promise<void> {
  /** List metric definitions, newest version of each key first. */
  app.get("/v1/reports/metrics", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const q = listMetricsQuery.parse(req.query);

    const filters: MetricFilters = {
      ...(q.module !== undefined ? { module: q.module } : {}),
      ...(q.status !== undefined ? { status: q.status } : {}),
      ...(q.governance !== undefined ? { governance: q.governance } : {}),
      ...(q.metricKey !== undefined ? { metricKey: q.metricKey } : {}),
    };
    const { rows, total } = await queries.listMetricDefinitions(
      ctx.tenantId,
      q.limit,
      q.offset,
      filters,
    );

    return reply.send({
      data: rows,
      meta: { page: Math.floor(q.offset / q.limit) + 1, pageSize: q.limit, total },
    });
  });

  /** Resolve the authoritative (published) definition for a metric key. */
  app.get("/v1/reports/metrics/by-key/:metricKey", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { metricKey } = metricKeyParam.parse(req.params);

    const row = await queries.getPublishedByKey(ctx.tenantId, metricKey);
    if (!row) {
      throw new HttpError(404, "NOT_FOUND", "no published metric definition for this key");
    }
    return reply.send({ data: row });
  });

  /** Single definition by id. */
  app.get("/v1/reports/metrics/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    const { id } = idParam.parse(req.params);

    const row = await queries.getMetricDefinition(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "metric definition not found");
    return reply.send({ data: row });
  });

  /** Create a draft definition. */
  app.post("/v1/reports/metrics", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const body = createMetricBody.parse(req.body);

    assertValid({
      metricKey: body.metricKey,
      aggregation: body.aggregation,
      numeratorSource: body.numeratorSource,
      denominatorSource: body.denominatorSource ?? null,
      dimensions: body.dimensions,
      period: body.period,
      governance: body.governance,
    });

    // Versions are explicit: a second definition for the same key must be created
    // through POST /:id/versions, so a plain create always starts at 1.
    const used = await repo.maxVersionNumber(body.metricKey, ctx.tenantId);
    if (used > 0) {
      throw new HttpError(
        409,
        "METRIC_KEY_EXISTS",
        `metricKey '${body.metricKey}' already exists (version ${used}); POST /:id/versions to add a version`,
      );
    }

    const projection: MetricDefinitionProjection = {
      id: randomUUID(),
      tenantId: ctx.tenantId,
      metricKey: body.metricKey,
      displayName: body.displayName,
      description: body.description ?? null,
      module: body.module,
      unit: body.unit,
      aggregation: body.aggregation,
      numeratorSource: body.numeratorSource,
      denominatorSource: body.denominatorSource ?? null,
      dimensions: body.dimensions,
      period: body.period,
      targetValue: body.targetValue ?? null,
      higherIsBetter: body.higherIsBetter,
      governance: body.governance,
      versionNumber: 1,
      status: "draft",
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
      version: 1,
    };

    return reply.code(202).send({ data: await commands.createMetricDefinition(ctx, projection) });
  });

  /** Update a draft, or the tenant-overridable fields of a published definition. */
  app.patch("/v1/reports/metrics/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateMetricBody.parse(req.body);

    const existing = await queries.getMetricDefinition(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "metric definition not found");

    const { version, ...rest } = body;
    const patch: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(rest)) {
      if (value !== undefined) patch[field] = value;
    }

    // Governance gate BEFORE the optimistic lock: an attempt to mutate a frozen
    // field is a governance conflict regardless of which version the caller holds.
    const rejection = checkPatchAllowed(existing, Object.keys(patch), ctx.tenantId);
    if (rejection) throw new HttpError(409, rejection.code, rejection.message);

    if (existing.version !== version) {
      throw new HttpError(
        409,
        "VERSION_CONFLICT",
        "metric definition has been modified; retry with the current version",
      );
    }

    // Re-validate the MERGED definition: patching only `aggregation` must still be
    // checked against the stored denominatorSource, and vice versa.
    assertValid({
      metricKey: (patch.metricKey as string | undefined) ?? existing.metricKey,
      aggregation: (patch.aggregation as string | undefined) ?? existing.aggregation,
      numeratorSource: (patch.numeratorSource as string | undefined) ?? existing.numeratorSource,
      denominatorSource:
        patch.denominatorSource === undefined
          ? existing.denominatorSource
          : (patch.denominatorSource as string | null),
      dimensions: (patch.dimensions as string[] | undefined) ?? existing.dimensions,
      period: (patch.period as string | undefined) ?? existing.period,
      governance: existing.governance,
    });

    return reply
      .code(202)
      .send({ data: await commands.updateMetricDefinition(ctx, id, version, patch) });
  });

  /** draft → published. */
  app.post("/v1/reports/metrics/:id/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = transitionBody.parse(req.body);

    const existing = await requireWritable(ctx.tenantId, id);
    const invalid = validateStatusTransition(existing.status, "published");
    if (invalid) throw new HttpError(422, "INVALID_STATUS_TRANSITION", invalid);
    assertVersion(existing.version, body.version);

    return reply.code(202).send({
      data: await commands.publishMetricDefinition(ctx, id, body.version, existing.metricKey),
    });
  });

  /** published → deprecated. */
  app.post("/v1/reports/metrics/:id/deprecate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);
    const body = transitionBody.parse(req.body);

    const existing = await requireWritable(ctx.tenantId, id);
    const invalid = validateStatusTransition(existing.status, "deprecated");
    if (invalid) throw new HttpError(422, "INVALID_STATUS_TRANSITION", invalid);
    assertVersion(existing.version, body.version);

    return reply.code(202).send({
      data: await commands.deprecateMetricDefinition(ctx, id, body.version, existing.metricKey),
    });
  });

  /**
   * Create the next versionNumber as a new draft. The source row is untouched and
   * keeps serving until it is explicitly deprecated.
   */
  app.post("/v1/reports/metrics/:id/versions", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { id } = idParam.parse(req.params);

    const existing = await queries.getMetricDefinition(ctx.tenantId, id);
    if (!existing) throw new HttpError(404, "NOT_FOUND", "metric definition not found");

    const draft = nextVersionDraft(existing, ctx.tenantId);
    // The source may be platform-owned or the tenant may already hold later
    // versions, so the next number comes from what this tenant has used.
    const used = await repo.maxVersionNumber(existing.metricKey, ctx.tenantId);
    const versionNumber = Math.max(draft.versionNumber, used + 1);

    const projection: MetricDefinitionProjection = {
      ...draft,
      versionNumber,
      id: randomUUID(),
      tenantId: ctx.tenantId,
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
      version: 1,
    };

    return reply
      .code(202)
      .send({ data: await commands.createNextVersion(ctx, existing.id, projection) });
  });

  // Same module-local envelope as jobs/scheduled/templates: this service's other
  // route plugins each own their handler, and a plugin without one falls through
  // to Fastify's default (which turns a zod failure into a 500).
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (
      err instanceof ZodError ||
      (typeof err === "object" && err !== null && (err as { name?: string }).name === "ZodError")
    ) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED",
        message: "invalid request",
        correlationId,
        retryable: false,
        fieldErrors: (err as unknown as ZodError).issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
    }
    if (err instanceof HttpError) {
      return reply
        .code(err.status)
        .send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply
      .code(500)
      .send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}

function assertVersion(current: number, supplied: number): void {
  if (current !== supplied) {
    throw new HttpError(
      409,
      "VERSION_CONFLICT",
      "metric definition has been modified; retry with the current version",
    );
  }
}

/** 404 when absent, 409 CANONICAL_IMMUTABLE when the row belongs to the platform. */
async function requireWritable(
  tenantId: string,
  id: string,
): Promise<NonNullable<Awaited<ReturnType<typeof queries.getMetricDefinition>>>> {
  const existing = await queries.getMetricDefinition(tenantId, id);
  if (!existing) throw new HttpError(404, "NOT_FOUND", "metric definition not found");
  if (existing.tenantId !== tenantId) {
    throw new HttpError(
      409,
      "CANONICAL_IMMUTABLE",
      "platform canonical definitions are read-only; POST /versions to create a tenant-owned override",
    );
  }
  return existing;
}
