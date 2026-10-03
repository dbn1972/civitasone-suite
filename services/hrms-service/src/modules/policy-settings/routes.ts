/**
 * GET/PUT /v1/hrms/policy-settings -- per-tenant HR policy values (see registry.ts).
 *
 * Read: any HR role (the web needs the effective values to render honest copy).
 * Write: HR admin only -- these are rules (who may work remotely, due dates, what
 * managers see), not data entry. The PUT is a command; the consumer validates,
 * writes in a transaction and emits the audit event with before/after.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { sendAccepted } from "@civitasone/schemas/validate";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { POLICY_SCHEMAS, isPolicyKey } from "./registry.js";

const READ_ROLES = ["hr_admin", "hr_officer", "super_admin", "tenant_admin", "platform_admin"];
const WRITE_ROLES = ["hr_admin", "super_admin", "tenant_admin", "platform_admin"];

export async function policySettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/policy-settings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READ_ROLES);
    return reply.send({ data: await repo.listPolicies(ctx.tenantId) });
  });

  app.put("/v1/hrms/policy-settings/:key", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, WRITE_ROLES);
    const { key } = z.object({ key: z.string().max(64) }).parse(req.params);
    if (!isPolicyKey(key)) throw new HttpError(404, "UNKNOWN_POLICY_KEY", `no such policy setting '${key}'`);
    // Validate the body against the key's own schema (strict: unknown fields are an error).
    const schema = POLICY_SCHEMAS[key];
    const value = (schema as unknown as { strict: () => z.ZodTypeAny }).strict().parse(req.body);
    const id = randomUUID();
    await queue.publish(COMMANDS.policySettingSet, {
      messageId: id, type: COMMANDS.policySettingSet,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { tenantId: ctx.tenantId, key, value },
    });
    return sendAccepted(reply, acceptedResponseSchema, { id, status: "accepted", correlationId: ctx.correlationId });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
