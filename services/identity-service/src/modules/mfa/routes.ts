import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { enableMfaBody, enableMfa } from "./commands.js";

const ADMIN = ["platform_admin", "super_admin", "tenant_admin"];

interface MfaSetup {
  id: string;
  tenantId: string;
  userId: string;
  method: "totp" | "sms" | "email";
  secret: string;
  isEnabled: boolean;
  createdAt: string;
}

const mfaStore: MfaSetup[] = [];

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
    const body = z.object({
      method: z.enum(["totp", "sms", "email"]).default("totp"),
    }).parse(req.body);

    const existing = mfaStore.find(
      (m) => m.userId === ctx.actorId && m.tenantId === ctx.tenantId && m.method === body.method
    );
    if (existing && existing.isEnabled) {
      throw new HttpError(409, "ALREADY_ENABLED", "MFA method already enabled");
    }

    const secret = crypto.randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase();
    const record: MfaSetup = {
      id: crypto.randomUUID(),
      tenantId: ctx.tenantId,
      userId: ctx.actorId,
      method: body.method,
      secret,
      isEnabled: false,
      createdAt: new Date().toISOString(),
    };
    mfaStore.push(record);

    return reply.code(201).send({
      data: {
        id: record.id,
        method: record.method,
        secret: record.secret,
        provisioning_uri: `otpauth://totp/CivitasOne:${ctx.actorId}?secret=${secret}&issuer=CivitasOne`,
      },
    });
  });

  app.post("/identity/mfa/verify", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = z.object({
      code: z.string().min(6).max(8),
      method: z.enum(["totp", "sms", "email"]).default("totp"),
    }).parse(req.body);

    const setup = mfaStore.find(
      (m) => m.userId === ctx.actorId && m.tenantId === ctx.tenantId && m.method === body.method
    );
    if (!setup) {
      throw new HttpError(404, "NOT_FOUND", "MFA not set up for this method");
    }

    // In production, verify the TOTP code against the secret
    // For now, accept any valid-length code to enable MFA
    setup.isEnabled = true;

    return reply.code(200).send({
      data: { verified: true, method: body.method, enabledAt: new Date().toISOString() },
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
