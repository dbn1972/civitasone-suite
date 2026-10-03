import { randomUUID } from "node:crypto";
/**
 * Public resume upload for the careers apply form (GAP-RECRUITMENT-CAREERS-DETAIL-04).
 *
 *   POST /v1/careers/resume   PUBLIC  { tenantId, jobOpeningId, fileName, mimeType, contentBase64 }
 *                                     -> { resumeKey, fileName, sizeBytes }
 *
 * Abuse controls: only for a vacancy that is published and still open, a hard 5 MB cap on the
 * DECODED size, type + extension + magic-byte checks, a ClamAV scan (fail-closed in production),
 * and a per-client rate limit. The returned `resumeKey` is then sent with the application, which
 * accepts only keys under its own tenant's namespace.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { tenantStorage } from "@civitasone/db";
import { putObject, StorageNotConfiguredError } from "@civitasone/storage";
import { scanBuffer } from "@civitasone/scanner";
import { HttpError } from "../../shared/context.js";
import { MAX_RESUME_BYTES } from "./resume-domain.js";
import { PUBLIC_RESUME_TYPES, createFixedWindowLimiter, publicResumePrefix, resumeRateKey, scanVerdict, validatePublicResume } from "./careers-resume.js";
import { isApplicationOpen } from "./job-publication.js";
import * as repo from "./repo.js";

// base64 inflates by 4/3; allow the envelope on top of the 5 MB decoded cap.
const BODY_LIMIT = Math.ceil((MAX_RESUME_BYTES * 4) / 3) + 4096;
const uploadBody = z.object({
  tenantId: z.string().uuid(),
  jobOpeningId: z.string().uuid(),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().min(1).max(128),
  contentBase64: z.string().min(1),
});

const CLIENT_MAX = 10;
const CLIENT_WINDOW = "10 minutes";
const TENANT_WINDOW_MS = 10 * 60_000;

/**
 * Rate limits (own bucket, NOT the shared actorId-or-IP one): the key is tenant + vacancy + client IP, evaluated at
 * preHandler so the body is parsed; the loopback allow-list is switched off for this route; and a coarser
 * per-tenant cap sits on top. `req.ip` is the real client because the service trusts X-Forwarded-For only from
 * internal peers (INTERNAL_PROXY_TRUST); a direct external caller cannot spoof it.
 */
export async function careersResumeRoutes(app: FastifyInstance, opts: { tenantMax?: number } = {}): Promise<void> {
  const tenantCap = createFixedWindowLimiter(opts.tenantMax ?? Number(process.env.CAREERS_RESUME_TENANT_MAX ?? 100), TENANT_WINDOW_MS);
  app.post("/v1/careers/resume", {
    config: {
      public: true,
      rateLimit: {
        max: CLIENT_MAX,
        timeWindow: CLIENT_WINDOW,
        hook: "preHandler",
        allowList: [],
        keyGenerator: (req: { body?: unknown; ip: string }) => {
          const b = (req.body ?? {}) as { tenantId?: unknown; jobOpeningId?: unknown };
          return resumeRateKey(String(b.tenantId ?? ""), String(b.jobOpeningId ?? ""), req.ip);
        },
      },
    },
    bodyLimit: BODY_LIMIT,
  }, async (req, reply) => {
    const body = uploadBody.parse(req.body);
    if (!tenantCap.hit(body.tenantId)) throw new HttpError(429, "TOO_MANY_UPLOADS", "too many resume uploads for this office right now; please try again later");
    tenantStorage.enterWith({ tenantId: body.tenantId });
    const vacancy = await repo.findPublishedOpening(body.jobOpeningId, body.tenantId);
    if (!vacancy || !isApplicationOpen(vacancy as never, Date.now())) {
      throw new HttpError(404, "NOT_FOUND", "This vacancy is not accepting applications");
    }
    const bytes = Buffer.from(body.contentBase64, "base64");
    const errors = validatePublicResume({ fileName: body.fileName, mimeType: body.mimeType, bytes });
    if (errors.length > 0) throw new HttpError(422, "INVALID_RESUME", errors.join("; "));

    const verdict = scanVerdict((await scanBuffer(bytes)).status);
    if (verdict === "infected") throw new HttpError(422, "MALWARE_DETECTED", "the file was rejected by the virus scan");
    if (verdict === "unavailable") throw new HttpError(503, "SCAN_UNAVAILABLE", "the file could not be scanned right now; please try again shortly");

    const spec = PUBLIC_RESUME_TYPES[body.mimeType]!;
    const resumeKey = `${publicResumePrefix(body.tenantId)}${randomUUID()}.${spec.ext}`;
    try {
      await putObject(resumeKey, bytes, body.mimeType);
    } catch (err) {
      if (err instanceof StorageNotConfiguredError) throw new HttpError(503, "STORAGE_UNAVAILABLE", "resume upload is not available right now");
      throw err;
    }
    return reply.code(201).send({ resumeKey, fileName: body.fileName, sizeBytes: bytes.length });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.code(status).send({ code: (err as { code?: string }).code ?? "BAD_REQUEST", message: err.message, correlationId });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
