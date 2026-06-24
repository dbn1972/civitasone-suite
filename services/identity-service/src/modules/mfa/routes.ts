import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { and, eq } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import {
  encryptMfaSecret,
  decryptMfaSecret,
  generateBase32Secret,
  verifyTotp,
} from "../../shared/mfa-crypto.js";
import { mfaConfigs } from "./schema.js";
import { enableMfaBody, enableMfa } from "./commands.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];

export async function mfaRoutes(app: FastifyInstance): Promise<void> {
  app.post("/identity/users/:id/mfa", async (req, reply) => {
    const ctx = resolveContext(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (ctx.actorId !== id) requireRole(ctx, ADMIN);
    const body = enableMfaBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await enableMfa(ctx, id, body));
  });

  // P0-3: real TOTP enrollment. Generate a base32 secret, store it encrypted at
  // rest (AES-256-GCM via MFA_ENC_KEY), and return the secret + provisioning URI
  // EXACTLY ONCE so the authenticator app can enroll. enabled stays false until
  // the user proves possession via /mfa/verify.
  app.post("/identity/mfa/setup", async (req, reply) => {
    const ctx = resolveContext(req);
    z.object({ method: z.literal("totp").default("totp") }).parse(req.body ?? {});

    const existing = await db.select().from(mfaConfigs)
      .where(and(eq(mfaConfigs.userId, ctx.actorId), eq(mfaConfigs.tenantId, ctx.tenantId)))
      .limit(1);
    if (existing[0]?.enabled) {
      throw new HttpError(409, "ALREADY_ENABLED", "MFA already enabled");
    }

    const secret = generateBase32Secret();
    const encrypted = encryptMfaSecret(secret);
    const now = new Date();

    if (existing[0]) {
      await db.update(mfaConfigs)
        .set({
          method: "totp", secret: encrypted, enabled: false,
          updatedBy: ctx.actorId, version: existing[0].version + 1, updatedAt: now,
        })
        .where(and(eq(mfaConfigs.userId, ctx.actorId), eq(mfaConfigs.tenantId, ctx.tenantId)));
    } else {
      await db.insert(mfaConfigs).values({
        tenantId: ctx.tenantId, userId: ctx.actorId, method: "totp",
        secret: encrypted, enabled: false, createdBy: ctx.actorId, updatedBy: ctx.actorId, version: 1,
      });
    }

    const issuer = "CivitasOne";
    return reply.code(201).send({
      data: {
        method: "totp",
        secret,
        provisioning_uri: `otpauth://totp/${issuer}:${ctx.actorId}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`,
      },
    });
  });

  // P0-3: real verification. Load the persisted ENCRYPTED secret, decrypt, and
  // check the supplied 6-digit code against the live RFC-6238 TOTP. On success
  // flip enabled=true. The secret is NEVER echoed back.
  app.post("/identity/mfa/verify", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = z.object({
      code: z.string().regex(/^\d{6}$/, "code must be 6 digits"),
      method: z.literal("totp").default("totp"),
    }).parse(req.body);

    const rows = await db.select().from(mfaConfigs)
      .where(and(eq(mfaConfigs.userId, ctx.actorId), eq(mfaConfigs.tenantId, ctx.tenantId)))
      .limit(1);
    const config = rows[0];
    if (!config || !config.secret) {
      throw new HttpError(404, "NOT_FOUND", "MFA not set up");
    }

    let base32Secret: string;
    try {
      base32Secret = decryptMfaSecret(config.secret);
    } catch {
      throw new HttpError(500, "INTERNAL", "MFA secret unreadable");
    }

    if (!verifyTotp(base32Secret, body.code)) {
      throw new HttpError(401, "INVALID_CODE", "invalid TOTP code");
    }

    if (!config.enabled) {
      await db.update(mfaConfigs)
        .set({ enabled: true, updatedBy: ctx.actorId, version: config.version + 1, updatedAt: new Date() })
        .where(and(eq(mfaConfigs.userId, ctx.actorId), eq(mfaConfigs.tenantId, ctx.tenantId)));
    }

    return reply.code(200).send({
      data: { verified: true, method: "totp", enabledAt: new Date().toISOString() },
    });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
