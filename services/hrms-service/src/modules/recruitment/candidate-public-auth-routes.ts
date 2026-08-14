import { randomUUID, randomBytes, createHmac, timingSafeEqual } from "node:crypto";
/**
 * Public candidate authentication — passwordless OTP login for the careers portal.
 *
 *   POST /v1/careers/auth/otp-request   send a 6-digit OTP to the candidate's email
 *   POST /v1/careers/auth/otp-verify    verify OTP + return a signed cand_token
 *
 * These routes are public (no HR auth). They use the same OTP table
 * (hrms_candidate_otp_challenges) as the HR-facing OTP flow, but with a
 * separate code path that issues a candidate-scoped signed token instead of
 * an HR session token.
 *
 * Token format: base64url(JSON payload) + "." + HMAC-SHA256 signature
 * Payload: { candidateId, tenantId, email, exp (unix seconds) }
 * Verified by candidate-public-portal-routes.ts on every portal request.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { eq, and } from "drizzle-orm";
import { HttpError } from "../../shared/context.js";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsCandidates, hrmsCandidateOtpChallenges } from "./candidate-schema.js";
import { generateOtp, verifyOtp, OTP_TTL_SECONDS, MAX_ATTEMPTS } from "./otp-verify.js";

const SYSTEM_ACTOR = "00000000-0000-0000-0000-000000000000";
const CAND_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

function candSecret(): string {
  return process.env.CANDIDATE_JWT_SECRET ?? "dev-cand-secret-not-for-production";
}

export function signCandToken(payload: { candidateId: string; tenantId: string; email: string; exp: number }): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", candSecret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyCandToken(token: string): { candidateId: string; tenantId: string; email: string; exp: number } | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", candSecret()).update(data).digest("base64url");
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch { return null; }
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString());
    if (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) return null;
    return payload as { candidateId: string; tenantId: string; email: string; exp: number };
  } catch { return null; }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function candidatePublicAuthRoutes(app: FastifyInstance): Promise<void> {
  // POST /v1/careers/auth/otp-request
  // Accepts { email, tenantId }. Finds or creates the candidate, issues a 6-digit OTP.
  // In dev mode the OTP is echoed in the response. In prod it would be dispatched
  // via the notification service (external seam — not yet wired).
  app.post("/v1/careers/auth/otp-request", { config: { public: true } }, async (req, reply) => {
    const body = z.object({
      email: z.string().email().max(200),
      tenantId: z.string().uuid(),
    }).parse(req.body);

    const email = normalizeEmail(body.email);
    const tenantId = body.tenantId;

    // Find or create candidate by normalized email.
    const existing = await scopedRead((tx) =>
      tx.select({ id: hrmsCandidates.id, fullName: hrmsCandidates.fullName })
        .from(hrmsCandidates)
        .where(and(eq(hrmsCandidates.tenantId, tenantId), eq(hrmsCandidates.normalizedEmail, email)))
        .limit(1)
    );

    let candidateId: string;
    if (existing.length > 0) {
      candidateId = existing[0]!.id;
    } else {
      candidateId = randomUUID();
      await scopedRead((tx) =>
        tx.insert(hrmsCandidates).values({
          id: candidateId, tenantId,
          email, normalizedEmail: email,
          status: "draft",
          createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR,
        })
      );
    }

    const code = generateOtp(randomBytes);
    const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);
    const challengeId = randomUUID();

    await scopedRead((tx) =>
      tx.insert(hrmsCandidateOtpChallenges).values({
        id: challengeId, tenantId, candidateId,
        channel: "email", code, expiresAt, attempts: 0, verified: false,
      })
    );

    // NOTE: In production, publish a notification event here to email the code.
    // For now, we echo it in non-production environments only.
    const isDev = process.env.NODE_ENV !== "production";
    return reply.code(200).send({
      challengeId,
      candidateId,
      channel: "email",
      expiresIn: OTP_TTL_SECONDS,
      ...(isDev ? { devCode: code } : {}),
    });
  });

  // POST /v1/careers/auth/otp-verify
  // Accepts { email, code, tenantId }. Verifies the latest OTP challenge and
  // returns a signed cand_token the client stores as an httpOnly cookie.
  app.post("/v1/careers/auth/otp-verify", { config: { public: true } }, async (req, reply) => {
    const body = z.object({
      email: z.string().email().max(200),
      code: z.string().length(6).regex(/^\d{6}$/),
      tenantId: z.string().uuid(),
    }).parse(req.body);

    const email = normalizeEmail(body.email);
    const tenantId = body.tenantId;

    const candidates = await scopedRead((tx) =>
      tx.select({ id: hrmsCandidates.id, fullName: hrmsCandidates.fullName })
        .from(hrmsCandidates)
        .where(and(eq(hrmsCandidates.tenantId, tenantId), eq(hrmsCandidates.normalizedEmail, email)))
        .limit(1)
    );
    if (candidates.length === 0) throw new HttpError(404, "NOT_FOUND", "no account found for this email");
    const { id: candidateId, fullName } = candidates[0]!;

    const challenges = await scopedRead((tx) =>
      tx.select()
        .from(hrmsCandidateOtpChallenges)
        .where(and(
          eq(hrmsCandidateOtpChallenges.tenantId, tenantId),
          eq(hrmsCandidateOtpChallenges.candidateId, candidateId),
          eq(hrmsCandidateOtpChallenges.channel, "email"),
        ))
        .orderBy(hrmsCandidateOtpChallenges.createdAt)
        .limit(1)
    );
    if (challenges.length === 0) throw new HttpError(404, "NO_CHALLENGE", "request an OTP first");
    const challenge = challenges[0]!;

    if (challenge.attempts >= MAX_ATTEMPTS) throw new HttpError(429, "MAX_ATTEMPTS", "too many incorrect attempts; request a new OTP");

    const result = verifyOtp(challenge, body.code, Date.now());
    if (!result.valid) {
      await db.transaction(async (tx) => {
        await tx.update(hrmsCandidateOtpChallenges)
          .set({ attempts: challenge.attempts + 1 })
          .where(eq(hrmsCandidateOtpChallenges.id, challenge.id));
      });
      throw new HttpError(422, "OTP_INVALID", result.reason ?? "invalid code");
    }

    // Mark verified, update emailVerified flag on candidate.
    await db.transaction(async (tx) => {
      await tx.update(hrmsCandidateOtpChallenges).set({ verified: true })
        .where(eq(hrmsCandidateOtpChallenges.id, challenge.id));
      await tx.update(hrmsCandidates).set({ emailVerified: true, updatedAt: new Date() })
        .where(eq(hrmsCandidates.id, candidateId));
    });

    const exp = Math.floor(Date.now() / 1000) + CAND_TOKEN_TTL;
    const token = signCandToken({ candidateId, tenantId, email, exp });

    return reply.code(200).send({ candidateId, name: fullName ?? email.split("@")[0], token });
  });

  app.setErrorHandler(errHandler);
}

function errHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code((err as { status: number }).status).send({ code: (err as { code: string }).code, message: err.message, correlationId });
    return;
  }
  (req as { log: { error: (args: Record<string, unknown>, msg: string) => void } }).log.error({ err }, "candidate auth error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
}
