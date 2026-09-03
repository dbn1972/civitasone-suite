/**
 * WC-009 — sandbox environments with masked refresh. HTTP routes.
 *
 * WHAT THIS DOES:  registers a sandbox, defines per-field masking rules,
 * accepts a refresh REQUEST, requires a SECOND actor to approve it, then queues
 * the refresh and tracks its status and the record of what was masked.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:  move any data. No production row is ever
 * read or copied by admin-service. Approval enqueues the
 * `admin.sandbox_refresh.execute` command on the transactional outbox; its
 * consumer (modules/sandbox/consumer.ts) resolves the masking plan, records it,
 * and closes the job — the actual copy is an explicit stub at that one point.
 *
 * Fail-closed masking: a requested field with no masking rule resolves to
 * `redact`, never to pass-through (see domain.ts resolveStrategy).
 */
import { randomUUID } from "node:crypto";
import { publishAdminCommand } from "../../shared/f3-publish.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveContext, requireRole, HttpError, TENANT_ADMIN_ROLES } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { auditEvent, domainEvent, type OutboxCtx } from "../../shared/audit.js";
import { enqueue } from "../../shared/outbox.js";
import { listEnvelope, singleEnvelope, parseOrThrow, registerEnvelopeErrorHandler } from "../../shared/envelope.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import {
  SOURCE_ENVIRONMENTS,
  MASKING_STRATEGIES,
  buildMaskingPlan,
  assertPreserveJustified,
  assertApproverDistinct,
  assertAwaitingApproval,
  assertVersionMatch,
  assertSandboxRefreshable,
  type MaskingRule,
  type MaskingPlan,
} from "./domain.js";
import type { SandboxEnvironmentRow, MaskingRuleRow, RefreshJobRow, RefreshMaskedFieldRow } from "./schema.js";

const SANDBOX_ROLES = [...TENANT_ADMIN_ROLES];
const RESOURCE_SANDBOX = "sandbox_environment";
const RESOURCE_JOB = "sandbox_refresh";

const limitSchema = z.coerce.number().int().min(1).max(200);
const pageSchema = z.coerce.number().int().min(1).max(10_000).default(1);
const identifier = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9_-]*$/, "lower-case alphanumeric, - and _ only");
const sqlName = z.string().min(1).max(128).regex(/^[a-zA-Z_][a-zA-Z0-9_.]*$/, "invalid table/field name");

const registerBody = z.object({
  code: identifier,
  name: z.string().min(1).max(200),
  sourceEnvironment: z.enum(SOURCE_ENVIRONMENTS),
  notes: z.string().max(2000).default(""),
});

const ruleBody = z.object({
  tableName: sqlName,
  fieldName: sqlName,
  strategy: z.enum(MASKING_STRATEGIES),
  justification: z.string().max(2000).default(""),
});

const refreshBody = z.object({
  requestedFields: z.array(z.object({ tableName: sqlName, fieldName: sqlName })).min(1).max(200),
});

const decideBody = z.object({ expectedVersion: z.coerce.number().int().min(1) });
const rejectBody = z.object({
  expectedVersion: z.coerce.number().int().min(1),
  reason: z.string().min(3).max(1000),
});

const listQuery = z.object({ limit: limitSchema, page: pageSchema });
const jobListQuery = z.object({
  limit: limitSchema,
  page: pageSchema,
  status: z.enum(["pending_approval", "rejected", "queued", "running", "completed", "failed"]).optional(),
  sandboxId: z.string().uuid().optional(),
});
const idParam = z.object({ id: z.string().uuid() });

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function serializeSandbox(row: SandboxEnvironmentRow): Record<string, unknown> {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    sourceEnvironment: row.sourceEnvironment,
    status: row.status,
    lastRefreshAt: iso(row.lastRefreshAt),
    notes: row.notes,
    createdAt: iso(row.createdAt),
    version: row.version,
  };
}

function serializeRule(row: MaskingRuleRow): Record<string, unknown> {
  return {
    id: row.id,
    sandboxId: row.sandboxId,
    tableName: row.tableName,
    fieldName: row.fieldName,
    strategy: row.strategy,
    justification: row.justification,
    version: row.version,
  };
}

function serializeJob(row: RefreshJobRow, plan?: MaskingPlan): Record<string, unknown> {
  return {
    id: row.id,
    sandboxId: row.sandboxId,
    sourceEnvironment: row.sourceEnvironment,
    requestedFields: row.requestedFields,
    status: row.status,
    requestedBy: row.requestedBy,
    approvedBy: row.approvedBy,
    approvedAt: iso(row.approvedAt),
    rejectedReason: row.rejectedReason,
    startedAt: iso(row.startedAt),
    completedAt: iso(row.completedAt),
    dataMovement: row.dataMovement,
    maskedFieldCount: row.maskedFieldCount,
    preservedFieldCount: row.preservedFieldCount,
    failureReason: row.failureReason,
    createdAt: iso(row.createdAt),
    version: row.version,
    plan,
  };
}

/**
 * Recompute the fail-closed masking plan for a job, read-only, from its
 * stored `requestedFields` against the sandbox's CURRENT masking rules.
 *
 * GAP this closes: apply_sandbox_2 (the F3 consumer) already computes this
 * plan via buildMaskingPlan, purely so the requester can see the fail-closed
 * outcome before a second actor approves it — but its return type is
 * `Promise<void>` (F3 conversion discards the result) and the plan is never
 * persisted, so there was no way for a caller to see it at all. Recomputing
 * on read avoids a schema change and stays consistent with the documented
 * semantics ("the authoritative plan is recomputed ... from the rules as
 * they stand then") — buildMaskingPlan/toDomainRules were already imported
 * here but unused before this fix.
 */
async function jobPlan(tenantId: string, job: RefreshJobRow): Promise<MaskingPlan> {
  const { rows } = await repo.listMaskingRules(tenantId, job.sandboxId, 500, 0);
  return buildMaskingPlan(job.requestedFields, toDomainRules(rows));
}

function serializeMaskedField(row: RefreshMaskedFieldRow): Record<string, unknown> {
  return {
    tableName: row.tableName,
    fieldName: row.fieldName,
    strategy: row.strategy,
    ruleSource: row.ruleSource,
  };
}

function toDomainRules(rows: readonly MaskingRuleRow[]): MaskingRule[] {
  return rows.map((r) => ({
    tableName: r.tableName,
    fieldName: r.fieldName,
    // The CHECK constraint + zod enum keep this column inside the union; the
    // cast is the narrowing of a varchar column, not a type escape hatch.
    strategy: r.strategy as MaskingRule["strategy"],
    justification: r.justification,
  }));
}

function outboxCtx(ctx: { tenantId: string; actorId: string; correlationId: string }): OutboxCtx {
  return { tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId };
}

export async function sandboxRoutes(app: FastifyInstance): Promise<void> {
  // ── register a sandbox environment ────────────────────────────────────────
  app.post("/v1/admin/sandboxes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SANDBOX_ROLES);
    const body = parseOrThrow(registerBody, req.body);

    // Synchronous pre-accept check mirroring apply_sandbox_0's
    // findSandboxByCodeTx guard — a duplicate code must fail fast as 409
    // rather than get a false-positive 202 and DLQ on the unique violation.
    const clash = await repo.findSandboxByCode(ctx.tenantId, body.code);
    if (clash) throw new HttpError(409, "SANDBOX_EXISTS", `a sandbox with code '${body.code}' already exists`);

    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: 'sandbox_op_0',
      body: (typeof body !== 'undefined' ? body : (req.body as Record<string, unknown>)),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    const created = { id: __f3Id, status: 'accepted', correlationId: ctx.correlationId } as never;
    return reply.code(202).send({ id: __f3Id, status: 'accepted', correlationId: ctx.correlationId, data: { id: __f3Id } });
  });

  app.get("/v1/admin/sandboxes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SANDBOX_ROLES);
    const q = parseOrThrow(listQuery, req.query);
    const { rows, total } = await repo.listSandboxes(ctx.tenantId, q.limit, (q.page - 1) * q.limit);
    return reply.send(listEnvelope(rows.map(serializeSandbox), { page: q.page, pageSize: q.limit, total }));
  });

  app.get("/v1/admin/sandboxes/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SANDBOX_ROLES);
    const { id } = parseOrThrow(idParam, req.params);
    const row = await repo.findSandbox(ctx.tenantId, id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "sandbox not found");
    return reply.send(singleEnvelope(serializeSandbox(row)));
  });

  // ── masking rules (per field) ─────────────────────────────────────────────
  app.post("/v1/admin/sandboxes/:id/masking-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SANDBOX_ROLES);
    const { id } = parseOrThrow(idParam, req.params);
    const body = parseOrThrow(ruleBody, req.body);
    assertPreserveJustified(body.strategy, body.justification);

    // Synchronous pre-accept check mirroring apply_sandbox_1's
    // findSandboxTx guard — an unknown (or cross-tenant) sandbox id must
    // fail fast as 404 rather than get a false-positive 202.
    const sandbox = await repo.findSandbox(ctx.tenantId, id);
    if (!sandbox) throw new HttpError(404, "NOT_FOUND", "sandbox not found");

    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: 'sandbox_op_1',
      body: (typeof body !== 'undefined' ? body : (req.body as Record<string, unknown>)),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    const saved = { id: __f3Id, status: 'accepted', correlationId: ctx.correlationId } as never;
    return reply.code(202).send({ id: __f3Id, status: 'accepted', correlationId: ctx.correlationId, data: { id: __f3Id } });
  });

  app.get("/v1/admin/sandboxes/:id/masking-rules", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SANDBOX_ROLES);
    const { id } = parseOrThrow(idParam, req.params);
    const q = parseOrThrow(listQuery, req.query);
    const sandbox = await repo.findSandbox(ctx.tenantId, id);
    if (!sandbox) throw new HttpError(404, "NOT_FOUND", "sandbox not found");
    const { rows, total } = await repo.listMaskingRules(ctx.tenantId, id, q.limit, (q.page - 1) * q.limit);
    return reply.send(listEnvelope(rows.map(serializeRule), { page: q.page, pageSize: q.limit, total }));
  });

  // ── request a masked refresh (MAKER half) ─────────────────────────────────
  app.post("/v1/admin/sandboxes/:id/refreshes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SANDBOX_ROLES);
    const { id } = parseOrThrow(idParam, req.params);
    const body = parseOrThrow(refreshBody, req.body);

    // Synchronous pre-accept checks mirroring apply_sandbox_2's
    // findSandboxTx + assertSandboxRefreshable guards — unknown sandbox,
    // disabled sandbox, and a refresh already in progress must all fail
    // fast instead of getting a false-positive 202.
    const sandbox = await repo.findSandbox(ctx.tenantId, id);
    if (!sandbox) throw new HttpError(404, "NOT_FOUND", "sandbox not found");
    assertSandboxRefreshable(sandbox.status);

    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: 'sandbox_op_2',
      body: (typeof body !== 'undefined' ? body : (req.body as Record<string, unknown>)),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    const result = { id: __f3Id, status: 'accepted', correlationId: ctx.correlationId } as never;
    return reply.code(202).send({ id: __f3Id, status: "accepted", correlationId: ctx.correlationId, data: { id: __f3Id } });
  });

  // ── list refresh jobs ─────────────────────────────────────────────────────
  app.get("/v1/admin/sandbox-refreshes", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SANDBOX_ROLES);
    const q = parseOrThrow(jobListQuery, req.query);
    const { rows, total } = await repo.listRefreshJobs(
      ctx.tenantId, q.limit, (q.page - 1) * q.limit, q.status, q.sandboxId,
    );
    const jobs = await Promise.all(rows.map(async (row) => serializeJob(row, await jobPlan(ctx.tenantId, row))));
    return reply.send(listEnvelope(jobs, { page: q.page, pageSize: q.limit, total }));
  });

  // ── approve a refresh (CHECKER half — queues the stubbed execution) ───────
  app.post("/v1/admin/sandbox-refreshes/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SANDBOX_ROLES);
    const { id } = parseOrThrow(idParam, req.params);
    const body = parseOrThrow(decideBody, req.body);

    // Synchronous pre-accept checks mirroring apply_sandbox_3's guards —
    // unknown job, a job not awaiting approval, self-approval, and a stale
    // expectedVersion must all fail fast instead of getting a
    // false-positive 202.
    const job = await repo.findRefreshJob(ctx.tenantId, id);
    if (!job) throw new HttpError(404, "NOT_FOUND", "refresh job not found");
    assertAwaitingApproval(job.status);
    assertApproverDistinct(job.requestedBy, ctx.actorId);
    assertVersionMatch(job.version, body.expectedVersion);

    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: 'sandbox_op_3',
      body: (typeof body !== 'undefined' ? body : (req.body as Record<string, unknown>)),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    const result = { id: __f3Id, status: 'accepted', correlationId: ctx.correlationId } as never;
    return reply.code(202).send({ id: __f3Id, status: "accepted", correlationId: ctx.correlationId, data: { id: __f3Id } });
  });

  // ── reject a refresh ─────────────────────────────────────────────────────
  app.post("/v1/admin/sandbox-refreshes/:id/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SANDBOX_ROLES);
    const { id } = parseOrThrow(idParam, req.params);
    const body = parseOrThrow(rejectBody, req.body);

    // Synchronous pre-accept checks mirroring apply_sandbox_4's guards —
    // same set as approve above.
    const job = await repo.findRefreshJob(ctx.tenantId, id);
    if (!job) throw new HttpError(404, "NOT_FOUND", "refresh job not found");
    assertAwaitingApproval(job.status);
    assertApproverDistinct(job.requestedBy, ctx.actorId);
    assertVersionMatch(job.version, body.expectedVersion);

    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: 'sandbox_op_4',
      body: (typeof body !== 'undefined' ? body : (req.body as Record<string, unknown>)),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    const result = { id: __f3Id, status: 'accepted', correlationId: ctx.correlationId } as never;
    return reply.code(202).send({ id: __f3Id, status: "accepted", correlationId: ctx.correlationId, data: { id: __f3Id } });
  });

  // ── what was masked for a completed refresh ───────────────────────────────
  app.get("/v1/admin/sandbox-refreshes/:id/masked-fields", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SANDBOX_ROLES);
    const { id } = parseOrThrow(idParam, req.params);
    const q = parseOrThrow(listQuery, req.query);
    const job = await repo.findRefreshJob(ctx.tenantId, id);
    if (!job) throw new HttpError(404, "NOT_FOUND", "refresh job not found");
    const { rows, total } = await repo.listMaskedFields(ctx.tenantId, id, q.limit, (q.page - 1) * q.limit);
    return reply.send(listEnvelope(rows.map(serializeMaskedField), { page: q.page, pageSize: q.limit, total }));
  });

  app.get("/v1/admin/sandbox-refreshes/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SANDBOX_ROLES);
    const { id } = parseOrThrow(idParam, req.params);
    const job = await repo.findRefreshJob(ctx.tenantId, id);
    if (!job) throw new HttpError(404, "NOT_FOUND", "refresh job not found");
    return reply.send(singleEnvelope(serializeJob(job, await jobPlan(ctx.tenantId, job))));
  });

  registerEnvelopeErrorHandler(app);
}
