import type { FastifyInstance } from "fastify";
import { ZodError, z } from "zod";
import { randomUUID } from "node:crypto";
import {
  deviceRegisterRequestSchema,
  deviceRegisterResponseSchema,
  stepUpResponseSchema,
} from "@civitasone/schemas/identity";
import { sendValidated } from "@civitasone/schemas/validate";
import { resolveContext } from "../../shared/context.js";
import * as repo from "./repo.js";

export async function deviceRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/devices/register", async (req, reply) => {
    const ctx = resolveContext(req);
    const body = deviceRegisterRequestSchema.parse(req.body);
    const trustToken = repo.mintTrustToken(body.deviceId, ctx.actorId);
    await repo.upsertDevice({
      id: body.deviceId,
      tenantId: ctx.tenantId,
      userId: ctx.actorId,
      platform: body.platform,
      label: body.label,
      fingerprint: body.fingerprint,
      trustToken,
      trustLevel: "recognized",
      createdBy: ctx.actorId,
      updatedBy: ctx.actorId,
    });
    sendValidated(reply, deviceRegisterResponseSchema, {
      deviceId: body.deviceId,
      trustToken,
      trustLevel: "recognized",
    });
  });

  app.post("/v1/devices/step-up", async (req, reply) => {
    const ctx = resolveContext(req);
    const headers = z.object({
      "x-device-id": z.string().uuid(),
      "x-device-trust-token": z.string().min(8),
    }).parse({
      "x-device-id": req.headers["x-device-id"],
      "x-device-trust-token": req.headers["x-device-trust-token"],
    });
    const device = await repo.findDevice(ctx.tenantId, headers["x-device-id"], ctx.actorId);
    if (!device || device.trustToken !== headers["x-device-trust-token"]) {
      return reply.code(403).send({ code: "DEVICE_NOT_TRUSTED", message: "device verification failed" });
    }
    const stepUpToken = randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    sendValidated(reply, stepUpResponseSchema, { stepUpToken, expiresAt });
  });
}
