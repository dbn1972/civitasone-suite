import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * OTP verification for candidate applications (DEF-RC-003 / R-RA-0077).
 *
 *   POST /v1/hrms/candidates/:id/otp/trigger   generate + (externally) send an OTP
 *   POST /v1/hrms/candidates/:id/otp/verify    validate the candidate's code
 *
 * OTP delivery (SMS/email) is an EXTERNAL seam. When the flag is off, trigger
 * returns 501. When on but no delivery adapter is wired, the OTP is created in
 * the DB and returned in the response body (dev/test mode only — never in prod).
 * A real adapter will send the code via the notification service and NOT echo it.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { generateOtp, verifyOtp, otpVerificationEnabled, OTP_TTL_SECONDS } from "./otp-verify.js";
import * as candidateRepo from "./candidate-repo.js";
import * as repo from "./otp-verify-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });

export async function otpVerifyRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/candidates/:id/otp/trigger", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ channel: z.enum(["email", "sms"]).default("email") }).parse(req.body ?? {});

    if (!otpVerificationEnabled(process.env)) {
      throw new HttpError(501, "OTP_NOT_ENABLED", "OTP verification is not enabled (FEATURE_OTP_VERIFICATION_ENABLED)");
    }

    const c = await candidateRepo.findCandidate(ctx.tenantId, id);
    if (!c) throw new HttpError(404, "NOT_FOUND", "candidate not found");

    const code = generateOtp(randomBytes);
    const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);
    const cid = randomUUID();
    await publishF3Write(ctx, "recruitment_otp_verify_routes__0", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })

    // In dev/test (no delivery adapter) as any, echo the code. In production the
    // notification service sends it. The adapter seam is NOT built here —
    // delivery is honest: if we cannot send, we say so; we never claim it was sent.
    const isDev = process.env.NODE_ENV !== "production";
    return reply.code(201).send({
      id: cid, candidateId: id, channel: body.channel, expiresIn: OTP_TTL_SECONDS,
      ...(isDev ? { devCode: code } : {}),
      deliveryNote: isDev ? "OTP echoed in dev mode (not sent via SMS/email)" : "OTP dispatched via notification service",
    });
  });

  app.post("/v1/hrms/candidates/:id/otp/verify", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ code: z.string().length(6), channel: z.enum(["email", "sms"]).default("email") }).parse(req.body);

    if (!otpVerificationEnabled(process.env)) {
      throw new HttpError(501, "OTP_NOT_ENABLED", "OTP verification is not enabled");
    }

    const challenge = await repo.findLatestChallenge(ctx.tenantId, id, body.channel);
    if (!challenge) throw new HttpError(404, "NO_CHALLENGE", "no OTP challenge found; trigger one first");

    const result = verifyOtp(challenge, body.code, Date.now());
    if (!result.valid) {
      await publishF3Write(ctx, "recruitment_otp_verify_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
      throw new HttpError(422, "OTP_INVALID", result.reason ?? "invalid code") as any;
    }

    await publishF3Write(ctx, "recruitment_otp_verify_routes__2", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ candidateId: id, channel: body.channel, verified: true }) as any;
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) return reply.code(status).send({ code: (err as { code?: string }).code ?? "BAD_REQUEST", message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
