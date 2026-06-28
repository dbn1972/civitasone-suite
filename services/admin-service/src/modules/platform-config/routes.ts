/**
 * Platform configuration routes — controllable parameters (editable) and
 * infrastructure parameters (read-only view for operators).
 *
 * Controllable: cache TTL, rate limits, log level, notification channels.
 * Read-only: DB, Redis, SQS, PgBouncer, Keycloak, encryption status.
 */
import type { FastifyInstance } from "fastify";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";

const PLATFORM_ADMIN = ["platform_admin", "super_admin"];

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
    const body = req.body as Partial<PlatformConfig["controllable"]>;

    if (body.cacheTtl) {
      for (const [k, v] of Object.entries(body.cacheTtl)) {
        if (typeof v === "number" && v >= 5 && v <= 3600) controllable.cacheTtl[k] = v;
      }
    }
    if (body.rateLimits) {
      if (typeof body.rateLimits.perMinute === "number") controllable.rateLimits.perMinute = Math.max(10, body.rateLimits.perMinute);
      if (typeof body.rateLimits.burstMax === "number") controllable.rateLimits.burstMax = Math.max(5, body.rateLimits.burstMax);
    }
    if (body.logLevel && ["debug", "info", "warn", "error"].includes(body.logLevel)) {
      controllable.logLevel = body.logLevel;
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
    const body = req.body as { durationMinutes?: number };
    const mins = Math.min(60, Math.max(5, body.durationMinutes ?? 15));
    const until = new Date(Date.now() + mins * 60000).toISOString();
    controllable.debugModeUntil = until;
    controllable.logLevel = "debug";
    return reply.send({ status: "debug_enabled", until, durationMinutes: mins });
  });
}
