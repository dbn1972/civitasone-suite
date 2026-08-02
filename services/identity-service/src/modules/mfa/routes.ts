import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { and, eq } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import {
  encryptMfaSecret,
  decryptMfaSecret,
  generateBase32Secret,
  verifyTotpStep,
} from "../../shared/mfa-crypto.js";
import { mfaConfigs } from "./schema.js";
import {
  enableMfaBody,
  enableMfa,
  setupMfa,
  recordMfaVerifyFailure,
  recordMfaVerifySuccess,
} from "./commands.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];

const MFA_MAX_FAILED = Number(process.env.MFA_MAX_FAILED_ATTEMPTS ?? 5);
const MFA_LOCKOUT_MS = Number(process.env.MFA_LOCKOUT_MS ?? 15 * 60 * 1000);
const TOTP_STEP_SECONDS = 30;

export async function mfaRoutes(app: FastifyInstance): Promise<void> {
  app.post("/identity/users/:id/mfa", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (ctx.actorId !== id) requireRole(ctx, ADMIN);
    const body = enableMfaBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await enableMfa(ctx, id, body));
  });

  app.post("/identity/mfa/setup", async (req, reply) => {
    const ctx = resolveContext(req);
    z.object({ method: z.literal("totp").default("totp") }).parse(req.body ?? {});

    const existing = await scopedRead((tx) =>
      tx
        .select()
        .from(mfaConfigs)
        .where(and(eq(mfaConfigs.userId, ctx.actorId), eq(mfaConfigs.tenantId, ctx.tenantId)))
        .limit(1),
    );
    if (existing[0]?.enabled) {
      throw new HttpError(409, "ALREADY_ENABLED", "MFA already enabled");
    }

    const secret = generateBase32Secret();
    const encrypted = encryptMfaSecret(secret);
    const accepted = await setupMfa(ctx, {
      encryptedSecret: encrypted,
      method: "totp",
      existing: Boolean(existing[0]),
      currentVersion: existing[0]?.version ?? 0,
    });

    const issuer = "CivitasOne";
    return reply.code(202).send({
      data: {
        ...accepted,
        method: "totp",
        secret,
        provisioning_uri: `otpauth://totp/${issuer}:${ctx.actorId}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`,
      },
    });
  });

  app.post("/identity/mfa/verify", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = z
      .object({
        code: z.string().regex(/^\d{6}$/, "code must be 6 digits"),
        method: z.literal("totp").default("totp"),
      })
      .parse(req.body);

    const rows = await scopedRead((tx) =>
      tx
        .select()
        .from(mfaConfigs)
        .where(and(eq(mfaConfigs.userId, ctx.actorId), eq(mfaConfigs.tenantId, ctx.tenantId)))
        .limit(1),
    );
    const config = rows[0];
    if (!config || !config.secret) {
      throw new HttpError(404, "NOT_FOUND", "MFA not set up");
    }

    const now = new Date();
    if (config.lockedUntil && config.lockedUntil > now) {
      const retryAfter = Math.ceil((config.lockedUntil.getTime() - now.getTime()) / 1000);
      throw new HttpError(429, "MFA_LOCKED", `too many failed attempts; try again in ${retryAfter}s`);
    }

    let base32Secret: string;
    try {
      base32Secret = decryptMfaSecret(config.secret);
    } catch {
      throw new HttpError(500, "INTERNAL", "MFA secret unreadable");
    }

    const matchedStep = verifyTotpStep(base32Secret, body.code, { stepSeconds: TOTP_STEP_SECONDS });

    if (matchedStep === null) {
      const nextFailed = (config.failedAttempts ?? 0) + 1;
      const lock = nextFailed >= MFA_MAX_FAILED;
      await recordMfaVerifyFailure(ctx, {
        nextFailed,
        lock,
        lockUntilMs: MFA_LOCKOUT_MS,
        currentVersion: config.version,
      });
      if (lock) {
        throw new HttpError(
          429,
          "MFA_LOCKED",
          `too many failed attempts; locked for ${Math.ceil(MFA_LOCKOUT_MS / 1000)}s`,
        );
      }
      throw new HttpError(401, "INVALID_CODE", "invalid TOTP code");
    }

    if (
      config.lastUsedStep !== null &&
      config.lastUsedStep !== undefined &&
      matchedStep <= config.lastUsedStep
    ) {
      throw new HttpError(401, "CODE_REPLAYED", "TOTP code already used");
    }

    return sendAccepted(
      reply,
      acceptedResponseSchema,
      await recordMfaVerifySuccess(ctx, {
        matchedStep,
        enable: !config.enabled,
        currentVersion: config.version,
      }),
    );
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply
        .code(400)
        .send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply
        .code(err.status)
        .send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
