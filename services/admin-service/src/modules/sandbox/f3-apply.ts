/** Auto-generated F3 apply (sandbox). */

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

function serializeJob(row: RefreshJobRow): Record<string, unknown> {
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
  };
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

export async function apply_sandbox_0(ctx: any, req: { body: unknown; params: unknown; query: unknown }): Promise<void> {
  // post:"/v1/admin/sandboxes"
    const body = parseOrThrow(registerBody, req.body);

    const created = await db.transaction(async (tx) => {
      // `uq_sandbox_env_code` would otherwise raise a driver-level unique
      // violation, which the error handler can only report as 500 INTERNAL. A
      // duplicate code is a client error, so answer it as one.
      const clash = await repo.findSandboxByCodeTx(tx as repo.Writer, ctx.tenantId, body.code);
      if (clash) {
        throw new HttpError(409, "SANDBOX_EXISTS", `a sandbox with code '${body.code}' already exists`);
      }
      const row = await repo.insertSandbox(tx as repo.Writer, {
        tenantId: ctx.tenantId,
        code: body.code,
        name: body.name,
        sourceEnvironment: body.sourceEnvironment,
        status: "registered",
        notes: body.notes,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });
      await domainEvent(tx, outboxCtx(ctx), EVENTS.sandboxRegistered, {
        sandboxId: row.id, code: row.code, sourceEnvironment: row.sourceEnvironment,
      });
      await auditEvent(tx, outboxCtx(ctx), "sandbox.registered", RESOURCE_SANDBOX, row.id, { code: row.code });
      return row;
    });
    return;
  
}

export async function apply_sandbox_1(ctx: any, req: { body: unknown; params: unknown; query: unknown }): Promise<void> {
  // post:"/v1/admin/sandboxes/:id/masking-rules"
    const { id } = parseOrThrow(idParam, req.params);
    const body = parseOrThrow(ruleBody, req.body);
    assertPreserveJustified(body.strategy, body.justification);

    const saved = await db.transaction(async (tx) => {
      const w = tx as repo.Writer;
      const sandbox = await repo.findSandboxTx(w, ctx.tenantId, id);
      if (!sandbox) throw new HttpError(404, "NOT_FOUND", "sandbox not found");
      const row = await repo.upsertMaskingRule(w, {
        tenantId: ctx.tenantId,
        sandboxId: id,
        tableName: body.tableName,
        fieldName: body.fieldName,
        strategy: body.strategy,
        justification: body.justification,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });
      // Audit records the field NAME and strategy only — never a value.
      await auditEvent(tx, outboxCtx(ctx), "sandbox.masking_rule.set", RESOURCE_SANDBOX, id, {
        tableName: row.tableName, fieldName: row.fieldName, strategy: row.strategy,
      });
      return row;
    });
    return;
  
}

export async function apply_sandbox_2(ctx: any, req: { body: unknown; params: unknown; query: unknown }): Promise<void> {
  // post:"/v1/admin/sandboxes/:id/refreshes"
    const { id } = parseOrThrow(idParam, req.params);
    const body = parseOrThrow(refreshBody, req.body);

    const result = await db.transaction(async (tx) => {
      const w = tx as repo.Writer;
      const sandbox = await repo.findSandboxTx(w, ctx.tenantId, id);
      if (!sandbox) throw new HttpError(404, "NOT_FOUND", "sandbox not found");
      assertSandboxRefreshable(sandbox.status);
      const rules = await repo.listMaskingRulesTx(w, ctx.tenantId, id);
      // Resolved here purely so the requester SEES the fail-closed plan before a
      // second actor approves it. The authoritative plan is recomputed by the
      // consumer at execution time from the rules as they stand then.
      const plan = buildMaskingPlan(body.requestedFields, toDomainRules(rules));
      const job = await repo.insertRefreshJob(w, {
        tenantId: ctx.tenantId,
        sandboxId: id,
        sourceEnvironment: sandbox.sourceEnvironment,
        requestedFields: body.requestedFields,
        status: "pending_approval",
        requestedBy: ctx.actorId,
        dataMovement: "stubbed",
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
      });
      await domainEvent(tx, outboxCtx(ctx), EVENTS.sandboxRefreshRequested, {
        jobId: job.id, sandboxId: id, sourceEnvironment: sandbox.sourceEnvironment,
      });
      await auditEvent(tx, outboxCtx(ctx), "sandbox_refresh.requested", RESOURCE_JOB, job.id, {
        sandboxId: id, fieldCount: plan.fields.length, maskedFieldCount: plan.maskedFieldCount,
      });
      return { job, plan };
    });
    return;
  
}

export async function apply_sandbox_3(ctx: any, req: { body: unknown; params: unknown; query: unknown }): Promise<void> {
  // post:"/v1/admin/sandbox-refreshes/:id/approve"
    const { id } = parseOrThrow(idParam, req.params);
    const body = parseOrThrow(decideBody, req.body);

    const result = await db.transaction(async (tx) => {
      const w = tx as repo.Writer;
      const job = await repo.findRefreshJobTx(w, ctx.tenantId, id);
      if (!job) throw new HttpError(404, "NOT_FOUND", "refresh job not found");
      assertAwaitingApproval(job.status);
      assertApproverDistinct(job.requestedBy, ctx.actorId);
      assertVersionMatch(job.version, body.expectedVersion);

      const moved = await repo.updateRefreshJob(w, ctx.tenantId, id, body.expectedVersion, {
        status: "queued",
        approvedBy: ctx.actorId,
        approvedAt: new Date(),
        updatedBy: ctx.actorId,
      });
      if (!moved) throw new HttpError(409, "VERSION_CONFLICT", "refresh job was modified concurrently; re-read and retry");

      const sandbox = await repo.findSandboxTx(w, ctx.tenantId, job.sandboxId);
      if (sandbox) {
        const flagged = await repo.updateSandboxStatus(w, ctx.tenantId, sandbox.id, sandbox.version, {
          status: "refreshing", updatedBy: ctx.actorId,
        });
        if (!flagged) throw new HttpError(409, "VERSION_CONFLICT", "sandbox was modified concurrently; re-read and retry");
      }

      // The command rides the transactional outbox, so "job is queued" and
      // "executor was told" commit together. Consumer: modules/sandbox/consumer.ts.
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: COMMANDS.sandboxRefreshExecute,
        eventType: COMMANDS.sandboxRefreshExecute,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        correlationId: ctx.correlationId,
        payload: { jobId: id, sandboxId: job.sandboxId, tenantId: ctx.tenantId },
      });
      await domainEvent(tx, outboxCtx(ctx), EVENTS.sandboxRefreshApproved, {
        jobId: id, sandboxId: job.sandboxId, requestedBy: job.requestedBy, approvedBy: ctx.actorId,
      });
      await auditEvent(tx, outboxCtx(ctx), "sandbox_refresh.approved", RESOURCE_JOB, id, {
        sandboxId: job.sandboxId, requestedBy: job.requestedBy,
      });
      return { jobId: id, status: "queued", version: body.expectedVersion + 1 };
    });
    return;
  
}

export async function apply_sandbox_4(ctx: any, req: { body: unknown; params: unknown; query: unknown }): Promise<void> {
  // post:"/v1/admin/sandbox-refreshes/:id/reject"
    const { id } = parseOrThrow(idParam, req.params);
    const body = parseOrThrow(rejectBody, req.body);

    const result = await db.transaction(async (tx) => {
      const w = tx as repo.Writer;
      const job = await repo.findRefreshJobTx(w, ctx.tenantId, id);
      if (!job) throw new HttpError(404, "NOT_FOUND", "refresh job not found");
      assertAwaitingApproval(job.status);
      assertApproverDistinct(job.requestedBy, ctx.actorId);
      assertVersionMatch(job.version, body.expectedVersion);
      const moved = await repo.updateRefreshJob(w, ctx.tenantId, id, body.expectedVersion, {
        status: "rejected", rejectedReason: body.reason, updatedBy: ctx.actorId,
      });
      if (!moved) throw new HttpError(409, "VERSION_CONFLICT", "refresh job was modified concurrently; re-read and retry");
      await domainEvent(tx, outboxCtx(ctx), EVENTS.sandboxRefreshRejected, { jobId: id, sandboxId: job.sandboxId });
      await auditEvent(tx, outboxCtx(ctx), "sandbox_refresh.rejected", RESOURCE_JOB, id);
      return { jobId: id, status: "rejected" };
    });
    return;
  
}

