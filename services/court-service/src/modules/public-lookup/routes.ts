import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { db, scopedRead } from "../../shared/db.js";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { queue } from "../../shared/infra.js";
import { normalizeCnr } from "../case-registry/domain.js";
import { EVENTS } from "../../topics.js";
import {
  hashMobile, hashOtp, generateOtp, constantTimeEqualHex, cnrPrefix, toPublicDocket,
  resolveAccessMode, verifyCaptcha, publicCaseUrl, hashIp,
} from "./domain.js";
import { publishEstablishmentBody, requestOtpBody, lookupBody } from "./validators.js";
import * as commands from "./commands.js";
import * as repo from "./repo.js";
import * as configRepo from "../config-registry/repo.js";

/** Roles permitted to publish the public establishment directory. */
const PUBLIC_DIR_ADMIN_ROLES = ["court_admin", "super_admin"];

/** OTP policy knobs. */
const OTP_TTL_SEC = 300;                 // 5 minutes
const OTP_RATE_WINDOW_MS = 15 * 60_000;  // 15 minutes
const OTP_RATE_MAX = 5;                   // max challenges per mobile per window
const OTP_IP_RATE_MAX = 20;               // max challenges per IP per window (anti SMS-bomb)

/**
 * SMS dispatch topic — declared in topics.ts as EVENTS.notificationSend (an
 * integration-out topic consumed by notification-service; court-service does NOT
 * subscribe it). This is the ONE place the raw mobile + OTP leave this service
 * (fire-and-forget to the notification service).
 */
const SMS_DISPATCH_TOPIC = EVENTS.notificationSend;

export async function publicLookupRoutes(app: FastifyInstance): Promise<void> {
  // ── Publish a public-directory establishment (AUTHENTICATED, admin) ───────────
  app.post("/v1/court/public-directory", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, PUBLIC_DIR_ADMIN_ROLES);
    const body = publishEstablishmentBody.parse(req.body);
    const result = await commands.publishEstablishment(ctx, body);
    return reply.code(202).send(result);
  });

  // ── Public directory listing (PUBLIC, no auth) ────────────────────────────────
  app.get("/v1/court/public/establishments", { config: { public: true } }, async (_req, reply) => {
    const rows = await repo.listActiveEstablishments();
    // Each court's shareable public case-status page link (publish this to citizens).
    const items = rows.map((e) => ({ ...e, publicUrl: publicCaseUrl(e.publicSlug) }));
    return reply.send({ items, count: items.length, source: "public" });
  });

  // ── Request an OTP for a public case-status lookup (PUBLIC) ────────────────────
  app.post("/v1/court/public/case-status/otp", { config: { public: true } }, async (req, reply) => {
    const body = requestOtpBody.parse(req.body);

    // Hash the mobile (PII → peppered hash) before it touches the DB. normalizeMobile
    // throws INVALID_MOBILE on <10 digits → surfaced as a 400.
    let mobileHash: string;
    try {
      mobileHash = hashMobile(body.mobile);
    } catch {
      throw new HttpError(400, "INVALID_MOBILE", "A valid 10-digit mobile number is required");
    }

    // Per-mobile rate limit (fail-closed on abuse).
    const sinceIso = new Date(Date.now() - OTP_RATE_WINDOW_MS).toISOString();
    const recent = await repo.countRecentChallenges(mobileHash, sinceIso);
    if (recent >= OTP_RATE_MAX) {
      throw new HttpError(429, "OTP_RATE_LIMITED", "Too many OTP requests; try again later");
    }
    // Per-IP limit: stops SMS-bombing arbitrary numbers from one source (the per-mobile
    // cap alone can't, since an attacker can submit unlimited DISTINCT numbers).
    const ipHash = hashIp(req.ip);
    if ((await repo.countRecentByIpHash(ipHash, sinceIso)) >= OTP_IP_RATE_MAX) {
      throw new HttpError(429, "OTP_RATE_LIMITED", "Too many OTP requests; try again later");
    }

    const challengeId = randomUUID();
    const otp = generateOtp(); // NEVER logged
    // No RLS on otp_challenges → a plain `db` write is correct (no tenant GUC needed).
    await repo.insertChallenge(db, {
      id: challengeId,
      mobileHash,
      otpHash: hashOtp(otp, challengeId),
      ipHash,
      purpose: "case_status",
      expiresAt: new Date(Date.now() + OTP_TTL_SEC * 1000),
    });

    // Fire-and-forget SMS dispatch — the ONLY place the RAW mobile + OTP leave this
    // service. Nothing here is persisted (only the hashes are stored above).
    await queue.publish(SMS_DISPATCH_TOPIC, {
      messageId: randomUUID(),
      type: SMS_DISPATCH_TOPIC,
      tenantId: "00000000-0000-0000-0000-000000000000",
      actorId: "public-otp",
      correlationId: ctx0(req),
      schemaVersion: "1.0",
      // Canonical notification.send contract (see notification-service
      // deliveries/consumer.ts + validators.ts): the consumer reads `recipient`
      // (destination — the phone) and `variables` (template vars — the OTP code).
      // The previous `{ to, template, otp }` shape was silently misdelivered: `to`
      // and top-level `otp` are ignored, and `recipient` fell back to actorId.
      // templateId is intentionally OMITTED — no `court_otp` template exists yet, so
      // the consumer uses its default fallback template (SYSTEM_TEMPLATE_IDS.default).
      // TODO(notification): register a `court_otp` SMS template in notification-service
      // and pass its templateId here so the OTP is templated correctly.
      payload: { channel: "sms", recipient: body.mobile, variables: { otp } },
    });

    const resBody: { challengeId: string; expiresInSec: number; devOtp?: string } = {
      challengeId,
      expiresInSec: OTP_TTL_SEC,
    };
    // TEST-ONLY: expose the OTP so unit/e2e tests can complete the flow without an SMS
    // gateway. Strictly guarded by NODE_ENV === 'test'; NEVER returned in prod.
    if (process.env.NODE_ENV === "test") {
      resBody.devOtp = otp;
    }
    return reply.send(resBody);
  });

  // ── Public case-status lookup (PUBLIC) — gate is per-court configurable ─────
  app.post("/v1/court/public/case-status", { config: { public: true } }, async (req, reply) => {
    const body = lookupBody.parse(req.body);
    if (!body.cnr) throw new HttpError(400, "VALIDATION_FAILED", "A cnr is required to look up a case");
    const normalizedCnr = normalizeCnr(body.cnr);

    // Resolve the tenant server-side from the public directory (slug or CNR prefix).
    // Establishment existence is public (the directory is public), so resolving
    // before the gate leaks nothing; CASE existence is revealed only after the gate.
    const est = body.slug
      ? await repo.findEstablishmentBySlug(body.slug)
      : await repo.findEstablishmentByPrefix(cnrPrefix(normalizedCnr));
    if (!est) throw new HttpError(404, "COURT_NOT_FOUND", "No matching court establishment");

    // The court's configured access method (otp | captcha | open); default otp. Read
    // under the resolved tenant GUC (config_entries is RLS-protected).
    const mode = await runWithTenant(est.tenantId, () =>
      scopedRead(async (tx) =>
        resolveAccessMode(await configRepo.getConfigValueOnTx(tx, est.tenantId, "public_lookup", "access_mode")),
      ),
    );

    // Enforce the configured gate.
    if (mode === "otp") {
      if (!body.challengeId || !body.otp) {
        throw new HttpError(400, "OTP_REQUIRED", "This court requires OTP verification (request an OTP first)");
      }
      // Atomic attempt-claim: increments + enforces (unconsumed, under cap, not expired)
      // in ONE statement — closes the check-then-act race against the 5-try cap.
      const claimed = await repo.claimAttempt(body.challengeId);
      if (!claimed) {
        // Security decision already made above; this read only shapes the error signal
        // (429 lockout vs 401) — a race here is cosmetic, not exploitable.
        const c = await repo.getChallenge(body.challengeId);
        if (c && !c.consumedAt && c.attempts >= c.maxAttempts) {
          throw new HttpError(429, "OTP_LOCKED", "Too many incorrect attempts");
        }
        throw new HttpError(401, "OTP_INVALID", "OTP is invalid or expired");
      }
      if (!constantTimeEqualHex(claimed.otpHash, hashOtp(body.otp, body.challengeId))) {
        throw new HttpError(401, "OTP_INVALID", "OTP is invalid or expired");
      }
      // Atomic single-use consume; if we lost the consume race, reject.
      if (!(await repo.consumeChallenge(body.challengeId))) {
        throw new HttpError(401, "OTP_INVALID", "OTP is invalid or expired");
      }
    } else if (mode === "captcha") {
      // eCourts / High-Court / Supreme-Court style: a CAPTCHA gates the public view.
      if (!verifyCaptcha(body.captchaToken)) {
        throw new HttpError(401, "CAPTCHA_INVALID", "Captcha verification failed");
      }
    }
    // mode === "open": no gate (the docket is public record).

    // Read court.cases (RLS-protected) UNDER the resolved tenant GUC.
    const docket = await runWithTenant(est.tenantId, () =>
      repo.getPublicCaseByCnr(est.tenantId, normalizedCnr),
    );
    if (!docket) throw new HttpError(404, "CASE_NOT_FOUND", "No case found for the given CNR");

    return reply.send({ case: toPublicDocket(docket), accessMode: mode, source: "public" });
  });

  // Uniform error shaping (mirrors the schema-error-handler envelope).
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: { code: "VALIDATION_FAILED", message: "Invalid request", details: err.issues } });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
    }
    _req.log.error({ err }, "public-lookup route error");
    return reply.code(500).send({ error: { code: "INTERNAL", message: "Internal error" } });
  });
}

/** Correlation id for a public (anonymous) request — from the auth plugin's ctx. */
function ctx0(req: { ctx?: { correlationId?: string } }): string {
  return req.ctx?.correlationId ?? randomUUID();
}
