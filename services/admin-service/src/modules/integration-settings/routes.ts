/**
 * integration-settings — HTTP routes.
 *
 * A tenant-scoped, RBAC-gated, maker-checker, encrypted-secret, audited
 * registry of external endpoints. Mirrors the central-config governance model:
 * a mutation is PROPOSED (PUT) into a pending change request and only APPLIED
 * to the live row when a DIFFERENT admin approves it (segregation of duties).
 *
 *   PUT     :provider/:env            → propose upsert (pending change) + audit
 *   POST    :provider/:env/approve    → maker-checker apply (version++) + audit
 *   POST    :provider/:env/reject     → reject pending + audit
 *   POST    :provider/:env/test       → real connection probe → status/last_error
 *   DELETE  :provider/:env            → disable + clear secret (version++) + audit
 *   GET     (list / one)              → masked reads (secrets NEVER returned)
 *
 * SYNCHRONOUS PRE-ACCEPT VALIDATION: PUT/approve/reject/DELETE are F3 routes —
 * they accept a write with a 202 before the mutation actually runs (applied
 * later by f3-consumer.ts / f3-apply.ts from the outbox). publishAdminCommand
 * is fire-and-forget and cannot reject, so the maker-checker + optimistic-lock
 * guards below are lifted synchronously — read-only — from the EXACT same
 * checks apply_integration_settings_0/1/2/4 run in f3-apply.ts, so the
 * synchronous and async paths agree. In particular the maker-checker
 * segregation check (assertApproverDistinct) now runs before "approve" is
 * accepted at all, instead of only after the fact inside the consumer — a
 * self-approval attempt gets a real 409 instead of a false-positive 202. A
 * TOCTOU race remains between these reads and the consumer's write (same
 * residual risk documented in hrms-service's cpf routes / uploads doc-routes
 * here); the consumer's own checks (and the DB) are the backstop for that.
 */
import { randomUUID } from "node:crypto";
import { publishAdminCommand } from "../../shared/f3-publish.js";
import { COMMANDS } from "../../topics.js";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError, TENANT_ADMIN_ROLES } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import * as repo from "./repo.js";
import {
  ConfigError,
  assertApproverDistinct,
  assertPending,
  assertVersionMatch,
  validateAndSplit,
  primaryLast4,
  sealSecrets,
  openSecrets,
  maskLast4,
} from "./domain.js";
import {
  PROVIDERS,
  ENV_SCOPES,
  REGISTRY,
  isProvider,
  isEnvScope,
  type Provider,
  type EnvScope,
} from "./providers.js";
import type { IntegrationSettingRow, IntegrationChangeRow } from "./schema.js";

const AUDIT_TOPIC = "audit.event.record";
const ROLES = [...TENANT_ADMIN_ROLES];

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const putBody = z.object({
  enabled: z.boolean().default(true),
  endpointUrl: z.string().max(2048).default(""),
  config: z.record(z.unknown()).default({}),
  note: z.string().max(1000).optional(),
  expectedVersion: z.coerce.number().int().min(1).optional(),
});
const rejectBody = z.object({ reason: z.string().min(3).max(1000) });
const listChangesQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

function parseTarget(params: unknown): { provider: Provider; env: EnvScope } {
  const p = params as { provider?: string; env?: string };
  if (!p.provider || !isProvider(p.provider)) {
    throw new HttpError(404, "UNKNOWN_PROVIDER", `unknown provider '${p.provider}'`);
  }
  if (!p.env || !isEnvScope(p.env)) {
    throw new HttpError(400, "INVALID_ENV_SCOPE", `env must be one of: ${ENV_SCOPES.join(", ")}`);
  }
  return { provider: p.provider, env: p.env };
}

/** Serialize a live setting for the API — secrets are NEVER included. */
function serializeSetting(provider: Provider, env: EnvScope, row: IntegrationSettingRow | undefined): Record<string, unknown> {
  const def = REGISTRY[provider];
  return {
    provider,
    envScope: env,
    category: def.category,
    label: def.label,
    secretFields: def.secretFields,
    enabled: row?.enabled ?? false,
    endpointUrl: row?.endpointUrl ?? "",
    config: row?.config ?? {},
    hasSecret: Boolean(row?.secretCiphertext),
    secretMasked: maskLast4(row?.secretLast4),
    status: row?.status ?? "unconfigured",
    lastTestedAt: row?.lastTestedAt?.toISOString?.() ?? null,
    lastError: row?.lastError ?? null,
    version: row?.version ?? 0,
    updatedAt: row?.updatedAt?.toISOString?.() ?? null,
    updatedBy: row?.updatedBy ?? null,
  };
}

function serializeChange(row: IntegrationChangeRow): Record<string, unknown> {
  return {
    id: row.id,
    provider: row.provider,
    envScope: row.envScope,
    enabled: row.enabled,
    endpointUrl: row.endpointUrl,
    config: row.config,
    secretChanged: row.secretChanged,
    secretMasked: maskLast4(row.secretLast4),
    note: row.note,
    status: row.status,
    proposedBy: row.proposedBy,
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt?.toISOString?.() ?? null,
    rejectedReason: row.rejectedReason,
    baseVersion: row.baseVersion,
    createdAt: row.createdAt?.toISOString?.() ?? null,
  };
}

async function audit(tx: Tx, ctx: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    payload: { service: "admin", action, resourceType: "integration_settings", resourceId, outcome: "success" },
  });
}

export async function integrationSettingsRoutes(app: FastifyInstance): Promise<void> {
  // ── catalog + list (masked) ────────────────────────────────────────────────
  app.get("/v1/admin/integrations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const rows = await repo.listSettings(ctx.tenantId);
    const byKey = new Map(rows.map((r) => [`${r.provider}:${r.envScope}`, r]));
    // Return the FULL catalog so the UI can render unconfigured providers too.
    const data: Record<string, unknown>[] = [];
    for (const provider of PROVIDERS) {
      for (const env of ENV_SCOPES) {
        data.push(serializeSetting(provider, env, byKey.get(`${provider}:${env}`)));
      }
    }
    return reply.send({ data });
  });

  // ── one (masked) + pending change + history ────────────────────────────────
  app.get("/v1/admin/integrations/:provider/:env", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { provider, env } = parseTarget(req.params);
    const row = await repo.findSetting(ctx.tenantId, provider, env);
    const history = await repo.listChanges(ctx.tenantId, provider, env, 50);
    const pending = history.find((c) => c.status === "pending");
    return reply.send({
      data: serializeSetting(provider, env, row),
      pendingChange: pending ? serializeChange(pending) : null,
      history: history.map(serializeChange),
    });
  });

  // ── propose an upsert (maker-checker) ──────────────────────────────────────
  app.put("/v1/admin/integrations/:provider/:env", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { provider, env } = parseTarget(req.params);
    const body = putBody.parse(req.body ?? {});

    // Validate + split provider config; seal secrets (fail-closed w/o key).
    const { config, secrets } = validateAndSplit(provider, body.config);
    const hasSecretInput = Object.keys(secrets).length > 0;
    const { ciphertext } = sealSecrets(secrets);
    const last4 = primaryLast4(provider, secrets);

    // Same optimistic-lock guard apply_integration_settings_0 runs: a
    // proposal against a stale expectedVersion is rejected up front instead
    // of being accepted and silently dropped by the consumer.
    const live = await repo.findSetting(ctx.tenantId, provider, env);
    if (live) assertVersionMatch(body.expectedVersion, live.version);

    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: 'integration_settings_op_0',
      body: (req.body as Record<string, unknown>),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    const change = { id: __f3Id, status: 'accepted', correlationId: ctx.correlationId } as never;
    return reply.code(202).send({ id: __f3Id, status: 'accepted', correlationId: ctx.correlationId, data: { id: __f3Id } });
  });

  // ── approve latest pending → apply (maker-checker + version++) ─────────────
  app.post("/v1/admin/integrations/:provider/:env/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { provider, env } = parseTarget(req.params);

    // Same guards apply_integration_settings_1 runs, in the same order,
    // lifted synchronously: a pending change must exist (404
    // NO_PENDING_CHANGE), it must still be pending (409 NOT_PENDING), the
    // approver must differ from the proposer (409 MAKER_CHECKER_VIOLATION —
    // the segregation-of-duties guard this maker-checker flow exists for),
    // and the live row must not have moved since the change was proposed
    // (409 VERSION_CONFLICT).
    const change = await scopedRead((tx) => repo.findLatestPendingTx(tx, ctx.tenantId, provider, env));
    if (!change) throw new HttpError(404, "NO_PENDING_CHANGE", "no pending change to approve");
    assertPending(change.status);
    assertApproverDistinct(change.proposedBy, ctx.actorId);
    const live = await repo.findSetting(ctx.tenantId, provider, env);
    assertVersionMatch(change.baseVersion, live?.version ?? 0);

    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: 'integration_settings_op_1',
      body: (req.body as Record<string, unknown>),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    const result = { id: __f3Id, status: 'accepted', correlationId: ctx.correlationId } as never;
    return reply.code(202).send({ id: __f3Id, status: "accepted", correlationId: ctx.correlationId, data: { id: __f3Id } });
  });

  // ── reject latest pending ──────────────────────────────────────────────────
  app.post("/v1/admin/integrations/:provider/:env/reject", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { provider, env } = parseTarget(req.params);
    const body = rejectBody.parse(req.body ?? {});

    // Same guards apply_integration_settings_2 runs, lifted synchronously.
    const change = await scopedRead((tx) => repo.findLatestPendingTx(tx, ctx.tenantId, provider, env));
    if (!change) throw new HttpError(404, "NO_PENDING_CHANGE", "no pending change to reject");
    assertPending(change.status);

    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: 'integration_settings_op_2',
      body: (req.body as Record<string, unknown>),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    return reply.send({ status: "rejected", provider, envScope: env });
  });

  // ── real connection probe (fail-closed) ────────────────────────────────────
  app.post("/v1/admin/integrations/:provider/:env/test", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { provider, env } = parseTarget(req.params);
    const row = await repo.findSetting(ctx.tenantId, provider, env);
    if (!row) {
      // Fail-closed: nothing to test. Never a fake success.
      return reply.code(409).send({ code: "NOT_CONFIGURED", message: "integration is not configured for this env", status: "unconfigured", ok: false });
    }
    const secrets = openSecrets(row.secretCiphertext);
    let result;
    try {
      result = await REGISTRY[provider].test({ config: row.config ?? {}, secrets, endpointUrl: row.endpointUrl ?? "" });
    } catch (err) {
      result = { status: "failed" as const, ok: false, error: `test threw: ${(err as Error).message}` };
    }
    await repo.recordTest(ctx.tenantId, row.id, result.status, result.ok ? null : (result.error ?? "unknown error"));

    // Audit the test action (outside the read tx — its own tx w/ outbox).
    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: 'integration_settings_op_3',
      body: (req.body as Record<string, unknown>),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    return reply.send({ provider, envScope: env, ok: result.ok, status: result.status, error: result.error ?? null, detail: result.detail ?? null });
  });

  // ── disable + clear secret (direct, audited, version++) ────────────────────
  app.delete("/v1/admin/integrations/:provider/:env", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ROLES);
    const { provider, env } = parseTarget(req.params);

    // Same existence guard apply_integration_settings_4 runs (404 NOT_FOUND),
    // lifted synchronously.
    const live = await repo.findSetting(ctx.tenantId, provider, env);
    if (!live) throw new HttpError(404, "NOT_FOUND", "integration not configured for this env");

    const __f3Id = randomUUID();
    await publishAdminCommand(ctx, COMMANDS.f3RouteWrite, __f3Id, {
      op: 'integration_settings_op_4',
      body: (req.body as Record<string, unknown>),
      params: req.params as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      preId: ((req.params as any)?.id as string) || __f3Id,
    });
    return reply.send({ status: "disabled", provider, envScope: env });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof ConfigError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
