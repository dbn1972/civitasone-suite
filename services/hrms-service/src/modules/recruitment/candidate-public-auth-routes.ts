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
import { runWithTenant } from "@civitasone/db";
import { HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { hrmsCandidates } from "./candidate-schema.js";
import { generateOtp, verifyOtp, OTP_TTL_SECONDS, MAX_ATTEMPTS } from "./otp-verify.js";
import * as otpRepo from "./otp-verify-repo.js";

/**
 * PRE-EXISTING bug fixed in passing (found while adding the F3 verification
 * smoke test for this file, not part of the sync-write conversion itself):
 * these routes are `config: { public: true }` — no authenticated session, so
 * app.ts's tenant-context hooks (which read `req.ctx.tenantId`, populated by
 * authPlugin) never run and `scopedRead()`'s ambient app.tenant_id GUC stays
 * unset. Against candidate.hrms_candidates / hrms_candidate_otp_challenges
 * (FORCE ROW LEVEL SECURITY, policy `tenant_id = current_setting('app.tenant_id',
 * true)::uuid`), that made EVERY scopedRead() call in this file throw
 * `invalid input syntax for type uuid: ""` as soon as the table held any row
 * at all (empty-table scans never evaluate the RLS predicate, so this was
 * invisible until a second candidate/request hit it) — i.e. the entire
 * careers-portal OTP login was broken against a real RLS-enforcing Postgres
 * from the second candidate onward, in both the old synchronous code and the
 * new async one. Fixed by explicitly establishing the ambient tenant context
 * from the request's OWN `tenantId` (there is no session to source it from —
 * same reasoning as `publishPublicF3Write` below and `commands.ts`'s
 * `createPublicApplication`), via this helper.
 */
async function scopedReadForTenant<T>(tenantId: string, fn: Parameters<typeof scopedRead<T>>[0]): Promise<T> {
  return runWithTenant(tenantId, () => scopedRead(fn));
}

/**
 * Same ambient-tenant-context problem as `scopedReadForTenant` above, for a
 * WRITE. `db.transaction` (what `scopedRead` wraps) sets the `app.tenant_id`
 * GUC from AsyncLocalStorage — on this public, unauthenticated route that
 * context is never populated by `authPlugin`, so it must be established
 * explicitly from the request's own `tenantId` before opening the
 * transaction, exactly as the read path does.
 */
async function scopedWriteForTenant<T>(tenantId: string, fn: Parameters<typeof scopedRead<T>>[0]): Promise<T> {
  return runWithTenant(tenantId, () => scopedRead(fn));
}

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

/**
 * These routes are public (`config: { public: true }`) — there is no
 * `resolveContext(req)`/`RequestContext` to hand `publishF3Write`, the same
 * way `recruitment/commands.ts`'s `createPublicApplication` bypasses it for
 * the (also unauthenticated) public job-application submission. Mirror that
 * precedent: publish the `f3RouteWrite` envelope directly with the SYSTEM
 * actor, using the request's correlation header (falling back to the
 * Fastify request id) as `correlationId`.
 */
async function publishPublicF3Write(
  correlationId: string, op: string, id: string, payload: Record<string, unknown>,
): Promise<void> {
  await queue.publish(COMMANDS.f3RouteWrite, {
    messageId: randomUUID(),
    type: COMMANDS.f3RouteWrite,
    tenantId: payload.tenantId as string,
    actorId: SYSTEM_ACTOR,
    correlationId,
    schemaVersion: "1.0",
    payload: { op, id, ...payload },
  });
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
    const existing = await scopedReadForTenant(tenantId, (tx) =>
      tx.select({ id: hrmsCandidates.id, fullName: hrmsCandidates.fullName })
        .from(hrmsCandidates)
        .where(and(eq(hrmsCandidates.tenantId, tenantId), eq(hrmsCandidates.normalizedEmail, email)))
        .limit(1)
    );

    const isNewCandidate = existing.length === 0;
    const candidateId = isNewCandidate ? randomUUID() : existing[0]!.id;

    const code = generateOtp(randomBytes);
    const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);
    const challengeId = randomUUID();

    // Async write: create-candidate-if-new + insert the OTP challenge. The
    // code/expiry are generated here (synchronously, so they can be echoed
    // in dev mode below) and forwarded on the payload — the consumer must
    // persist the SAME code that was (or will be) delivered, not a new one.
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    await publishPublicF3Write(correlationId, "recruitment_candidate_public_auth_routes__0", challengeId, {
      tenantId, candidateId, isNewCandidate, email, code, expiresAt: expiresAt.toISOString(),
    });

    // NOTE: In production, publish a notification event here to email the code.
    // For now, we echo it in non-production environments only.
    const isDev = process.env.NODE_ENV !== "production";
    return reply.code(202).send({
      challengeId,
      candidateId,
      channel: "email",
      expiresIn: OTP_TTL_SECONDS,
      ...(isDev ? { devCode: code } : {}),
    }) as any;
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

    const candidates = await scopedReadForTenant(tenantId, (tx) =>
      tx.select({ id: hrmsCandidates.id, fullName: hrmsCandidates.fullName })
        .from(hrmsCandidates)
        .where(and(eq(hrmsCandidates.tenantId, tenantId), eq(hrmsCandidates.normalizedEmail, email)))
        .limit(1)
    );
    if (candidates.length === 0) throw new HttpError(404, "NOT_FOUND", "no account found for this email");
    const { id: candidateId, fullName } = candidates[0]!;

    // SECURITY: the challenge row is read+checked+conditionally-incremented
    // inside ONE transaction, with the row locked (`FOR UPDATE`) via
    // otpRepo.lockOldestChallenge. This closes a brute-force race on this
    // PUBLIC, unauthenticated careers-portal endpoint: concurrent otp-verify
    // requests against the SAME challenge could each read a stale
    // (pre-increment) `attempts` count and slip past the MAX_ATTEMPTS gate
    // before an earlier failed attempt's increment had landed — the
    // increment used to be a DEFERRED async publish (queue-processed), so
    // the race window could be as wide as the queue's processing lag under
    // load, and trivially widened further by firing many concurrent guesses.
    // Locking the row here forces concurrent requests to serialize: each
    // sees the previous request's already-committed attempts count, so at
    // most MAX_ATTEMPTS guesses can ever be admitted per challenge,
    // regardless of concurrency. A correct code on a fresh challenge still
    // succeeds exactly as before — `attempts` is left untouched on success.
    const outcome = await scopedWriteForTenant(tenantId, async (tx) => {
      const challenge = await otpRepo.lockOldestChallenge(tx, tenantId, candidateId, "email");
      if (!challenge) return { kind: "no_challenge" as const };
      if (challenge.attempts >= MAX_ATTEMPTS) return { kind: "locked" as const };
      const result = verifyOtp(challenge, body.code, Date.now());
      if (!result.valid) {
        await otpRepo.incrementAttempts(tx, tenantId, challenge.id);
        return { kind: "invalid" as const, reason: result.reason, challengeId: challenge.id };
      }
      return { kind: "valid" as const, challengeId: challenge.id };
    });

    if (outcome.kind === "no_challenge") throw new HttpError(404, "NO_CHALLENGE", "request an OTP first");
    if (outcome.kind === "locked") throw new HttpError(429, "MAX_ATTEMPTS", "too many incorrect attempts; request a new OTP");

    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (outcome.kind === "invalid") {
      throw new HttpError(422, "OTP_INVALID", outcome.reason ?? "invalid code");
    }

    // Async write: mark the challenge verified + set candidate.emailVerified.
    // The token below is computed independently (HMAC over candidateId/tenantId/
    // email/exp — no DB read), so the caller gets a fully valid, usable token
    // immediately; only the audit/replay-guard bookkeeping write is deferred.
    // (Mirrors recruitment/otp-verify-routes.ts's identical `__2` case — see
    // that file's f3-consumer.ts cases for the established precedent.)
    await publishPublicF3Write(correlationId, "recruitment_candidate_public_auth_routes__2", randomUUID(), {
      tenantId, candidateId, challengeId: outcome.challengeId,
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
