/**
 * Platform configuration routes — controllable parameters (editable) and
 * infrastructure parameters (read-only view for operators).
 *
 * Controllable: cache TTL, rate limits, log level, notification channels.
 * Read-only: DB, Redis, SQS, PgBouncer, Keycloak, encryption status.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { auditEvent } from "../../shared/audit.js";

const AUDIT_TOPIC = "audit.event.record";

/**
 * GAP-ADMIN-CONFIG-03: every platform-config mutation is audited with the actor
 * and a before/after of the touched parameters (CLAUDE.md rule 8). Written to the
 * transactional outbox BEFORE the in-memory change is applied, so a failed audit
 * write rejects the request instead of leaving an unaudited change behind.
 */
async function auditConfigChange(
  ctx: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await db.transaction(async (tx) => {
    const t = tx as Parameters<typeof enqueue>[0];
    await enqueue(t, {
      topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: { service: "admin", action, resourceType: "platform_config", resourceId: "platform", outcome: "success", before, after },
    });
  });
}

const PLATFORM_ADMIN = ["platform_admin", "super_admin"];

const VALID_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

const patchConfigSchema = z.object({
  cacheTtl: z.record(z.string(), z.number().int().min(5).max(3600)).optional(),
  rateLimits: z.object({
    perMinute: z.number().int().min(10).optional(),
    burstMax: z.number().int().min(5).optional(),
  }).optional(),
  logLevel: z.string().optional(),
  debugModeUntil: z.string().nullable().optional(),
  notifications: z.object({
    emailProvider: z.string().optional(),
    smsProvider: z.string().optional(),
    emailFrom: z.string().email().optional(),
    smsFrom: z.string().optional(),
  }).optional(),
}).strict();

const debugModeSchema = z.object({
  durationMinutes: z.number().int().positive().optional(),
  // GAP-TENANT-ADMIN-PLATFORM-CONFIG-01: optional operator reason, recorded on
  // the audit event (debug logging is platform-wide; a reason aids triage).
  reason: z.string().trim().min(1).max(500).optional(),
}).strict();

const gatewayConfigSchema = z.object({
  jwtEdgeVerify: z.enum(["true", "audit", "off"]).optional(),
  upstreamTimeoutMs: z.number().int().min(1000).max(120000).optional(),
  cbFailureThreshold: z.number().int().min(1).max(50).optional(),
  cbRecoveryMs: z.number().int().min(1000).max(300000).optional(),
  rateLimitMax: z.number().int().min(10).max(100000).optional(),
  rateLimitTenantMax: z.number().int().min(10).max(10000).optional(),
  authRateLimitMax: z.number().int().min(3).max(1000).optional(),
  bodyLimitBytes: z.number().int().min(1024).max(52428800).optional(),
  // GAP-ADMIN-GATEWAY-CONFIG-02: platform-wide edge-auth / limit changes
  // must carry an operator reason; it goes to the audit record, never to the
  // gateway itself (stripped before forwarding below).
  reason: z.string().trim().min(3).max(500),
}).strict();

type PlatformConfig = {
  /** Editable settings */
  controllable: {
    cacheTtl: Record<string, number>;
    rateLimits: { perMinute: number; burstMax: number };
    logLevel: string;
    debugModeUntil: string | null;
    notifications: {
      emailProvider: string;
      smsProvider: string;
      emailFrom: string;
      smsFrom: string;
    };
  };
  /** Read-only infrastructure parameters */
  infrastructure: {
    database: { host: string; port: number; databases: number; poolMode: string; maxConnections: number; rlsEnabled: boolean };
    redis: { url: string; status: string };
    queue: { driver: string; endpoint: string; region: string };
    auth: { provider: string; algorithm: string; realm: string; audienceConfigured: boolean };
    pgbouncer: { configured: boolean; port: number; poolMode: string; maxClientConn: number; defaultPoolSize: number };
    encryption: { piiAtRest: boolean; mfaAtRest: boolean; algorithm: string };
    storage: { driver: string; bucket: string; endpoint: string };
  };
};

function getInfrastructureParams(): PlatformConfig["infrastructure"] {
  const dbUrl = process.env.DATABASE_URL || "postgres://...@localhost:5435/civitas_admin";
  const dbHost = dbUrl.match(/@([^:/]+)/)?.[1] || "localhost";
  const dbPort = Number(dbUrl.match(/:(\d{4})\//)?.[1] || 5435);

  return {
    database: {
      host: dbHost,
      port: dbPort,
      databases: 31,
      poolMode: process.env.DB_VIA_PGBOUNCER === "true" ? "transaction (via PgBouncer)" : "direct (per-service pool)",
      maxConnections: Number(process.env.DB_POOL_MAX || 10),
      rlsEnabled: true,
    },
    redis: {
      url: (process.env.REDIS_URL || "redis://localhost:6381").replace(/\/\/[^:]*:[^@]*@/, "//***:***@"),
      status: "connected",
    },
    queue: {
      driver: process.env.QUEUE_DRIVER || "sqs",
      endpoint: process.env.AWS_ENDPOINT_URL || "http://localhost:4566",
      region: process.env.AWS_DEFAULT_REGION || "ap-south-1",
    },
    auth: {
      provider: "Keycloak",
      algorithm: process.env.JWT_ALGORITHM || "RS256",
      realm: process.env.KEYCLOAK_REALM || "civitasone",
      audienceConfigured: Boolean(process.env.JWT_AUDIENCE || process.env.KEYCLOAK_CLIENT_ID),
    },
    pgbouncer: {
      configured: true,
      port: 6432,
      poolMode: "transaction",
      maxClientConn: 500,
      defaultPoolSize: 20,
    },
    encryption: {
      piiAtRest: Boolean(process.env.PII_ENC_KEY),
      mfaAtRest: Boolean(process.env.MFA_ENC_KEY),
      algorithm: "AES-256-GCM",
    },
    storage: {
      driver: "S3",
      bucket: process.env.AWS_S3_BUCKET || "civitasone",
      endpoint: process.env.AWS_ENDPOINT_URL || "http://localhost:4566",
    },
  };
}

// In-memory controllable config (production would persist to DB/Redis).
const controllable: PlatformConfig["controllable"] = {
  cacheTtl: {
    finance: 60,
    procurement: 60,
    hrms: 60,
    payroll: 120,
    reports: 300,
    analytics: 120,
    default: 60,
  },
  rateLimits: {
    perMinute: 120,
    burstMax: 30,
  },
  logLevel: process.env.LOG_LEVEL || "info",
  debugModeUntil: null,
  notifications: {
    emailProvider: process.env.EMAIL_PROVIDER || "smtp",
    smsProvider: process.env.SMS_PROVIDER || "none",
    emailFrom: process.env.EMAIL_FROM || "noreply@civitasone.in",
    smsFrom: process.env.SMS_FROM || "CIVONE",
  },
};

export async function platformConfigRoutes(app: FastifyInstance): Promise<void> {
  // GET full platform config (read-only infra + controllable)
  app.get("/v1/admin/platform-config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM_ADMIN);
    const config: PlatformConfig = {
      controllable,
      infrastructure: getInfrastructureParams(),
    };
    return reply.send(config);
  });

  // PATCH controllable parameters
  app.patch("/v1/admin/platform-config", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM_ADMIN);
    const body = patchConfigSchema.parse(req.body);

    // Audit first (see auditConfigChange): snapshot only the parameters this request touches.
    const touched = Object.keys(body) as (keyof typeof controllable)[];
    // `after` is the merged subtree for the same keys as `before` (not the raw partial body).
    const before = Object.fromEntries(touched.map((k) => [k, structuredClone(controllable[k])]));
    const after: Record<string, unknown> = {};
    for (const k of touched) {
      const patch = body[k] as unknown;
      const prev = controllable[k] as unknown;
      after[k] = patch !== null && typeof patch === "object" && prev !== null && typeof prev === "object"
        ? { ...(prev as Record<string, unknown>), ...(patch as Record<string, unknown>) }
        : patch;
    }
    // Same side effects as the apply step below: an invalid logLevel is ignored; enabling debug forces "debug".
    if ("logLevel" in after && !(VALID_LOG_LEVELS as readonly string[]).includes(String(after.logLevel))) after.logLevel = controllable.logLevel;
    if (typeof body.debugModeUntil === "string" && body.debugModeUntil) {
      (before as Record<string, unknown>).logLevel ??= controllable.logLevel;
      after.logLevel = "debug";
    }
    await auditConfigChange(ctx, "platform_config.update", before, after);

    if (body.cacheTtl) {
      for (const [k, v] of Object.entries(body.cacheTtl)) {
        controllable.cacheTtl[k] = v;
      }
    }
    if (body.rateLimits) {
      if (body.rateLimits.perMinute !== undefined) controllable.rateLimits.perMinute = body.rateLimits.perMinute;
      if (body.rateLimits.burstMax !== undefined) controllable.rateLimits.burstMax = body.rateLimits.burstMax;
    }
    if (body.logLevel) {
      if ((VALID_LOG_LEVELS as readonly string[]).includes(body.logLevel)) {
        controllable.logLevel = body.logLevel;
      }
      // invalid logLevel values are silently ignored
    }
    if (body.debugModeUntil !== undefined) {
      // Auto-reverts: set a future ISO timestamp; null = off
      controllable.debugModeUntil = body.debugModeUntil;
      if (body.debugModeUntil) controllable.logLevel = "debug";
    }
    if (body.notifications) {
      Object.assign(controllable.notifications, body.notifications);
    }

    return reply.send({ status: "updated", controllable });
  });

  // POST debug mode (time-limited, auto-reverts)
  app.post("/v1/admin/platform-config/debug-mode", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM_ADMIN);
    const body = debugModeSchema.parse(req.body);
    const raw = body.durationMinutes ?? 15;
    const mins = Math.min(60, Math.max(5, raw)); // clamp to [5, 60]
    const until = new Date(Date.now() + mins * 60000).toISOString();
    await auditConfigChange(
      ctx,
      "platform_config.debug_mode",
      { debugModeUntil: controllable.debugModeUntil, logLevel: controllable.logLevel },
      { debugModeUntil: until, logLevel: "debug", ...(body.reason ? { reason: body.reason } : {}) },
    );
    controllable.debugModeUntil = until;
    controllable.logLevel = "debug";
    return reply.send({ status: "debug_enabled", until, durationMinutes: mins });
  });

  // ── Gateway configuration (read + write via internal API) ─────────────────
  const GATEWAY_URL = process.env.GATEWAY_INTERNAL_URL ?? process.env.GATEWAY_URL ?? "http://127.0.0.1:8080";
  const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? "";

  app.get("/v1/admin/platform-config/gateway", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM_ADMIN);
    try {
      const res = await fetch(`${GATEWAY_URL}/internal/config`, {
        headers: { "x-internal-secret": INTERNAL_SECRET },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        throw new HttpError(502, "GATEWAY_UNREACHABLE", `Gateway returned ${res.status}`);
      }
      const body = await res.json() as { data: unknown };
      return reply.send(body);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, "GATEWAY_UNREACHABLE", "Cannot reach gateway service for config");
    }
  });

  app.patch("/v1/admin/platform-config/gateway", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PLATFORM_ADMIN);
    const { reason, ...body } = gatewayConfigSchema.parse(req.body);
    if (Object.keys(body).length === 0) {
      throw new HttpError(400, "EMPTY_BODY", "at least one gateway setting must be provided");
    }
    // Best-effort "before" snapshot for the audit diff: a failed read must not
    // block an operator from fixing a misconfigured gateway, so it degrades
    // to `null` (recorded as unknown) instead of failing the PATCH.
    let before: Record<string, unknown> | null = null;
    try {
      const cur = await fetch(`${GATEWAY_URL}/internal/config`, {
        headers: { "x-internal-secret": INTERNAL_SECRET },
        signal: AbortSignal.timeout(5000),
      });
      if (cur.ok) {
        const curBody = (await cur.json()) as { data?: unknown };
        if (curBody.data && typeof curBody.data === "object") before = curBody.data as Record<string, unknown>;
      }
    } catch {
      before = null;
    }
    let result: { status: string; data: unknown };
    try {
      const res = await fetch(`${GATEWAY_URL}/internal/config`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": INTERNAL_SECRET,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({})) as { message?: string };
        throw new HttpError(res.status === 400 ? 400 : 502, "GATEWAY_CONFIG_ERROR", errBody.message ?? `Gateway returned ${res.status}`);
      }
      result = await res.json() as { status: string; data: unknown };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, "GATEWAY_UNREACHABLE", "Cannot reach gateway service");
    }
    // GAP-ADMIN-GATEWAY-CONFIG-02: every applied change is audited with the
    // actor (ctx.actorId), the reason, and per-field before/after. The
    // gateway holds this config in memory (no admin-service row to write),
    // so the audit record is the only durable trail of who changed what.
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of Object.entries(body)) {
      changes[k] = { from: before ? before[k] ?? null : null, to: v };
    }
    await db.transaction(async (tx) => {
      await auditEvent(
        tx,
        { tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId },
        "gateway_config.update",
        "gateway_config",
        "gateway",
        { reason, changes, beforeKnown: before !== null },
      );
    });
    return reply.send(result);
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
