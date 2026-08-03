import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Interview recording / transcript with consent + retention (R-RA-0152).
 *
 *   POST   /v1/hrms/interviews/:id/recordings        register (consent required)
 *   GET    /v1/hrms/interviews/:id/recordings        list active artefacts
 *   DELETE /v1/hrms/interview-recordings/:id         erase (soft-delete + purge bytes)
 *   GET    /v1/hrms/recordings/expired?asOf=         retention purge candidates
 *
 * Consent is mandatory (fail closed). Each artefact carries a retention deadline;
 * the media lives behind an object-storage SEAM — only its key is stored here.
 * Deleting an artefact soft-deletes the record and asks the storage adapter to
 * remove the object (stubbed until the adapter is wired — logged, never faked).
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import {
  RECORDING_KINDS, DEFAULT_RETENTION_DAYS, MIN_RETENTION_DAYS, MAX_RETENTION_DAYS,
  validateRecording, recordingKeyPrefix, computeRetentionUntil,
} from "./interview-recording.js";
import * as repo from "./interview-recording-repo.js";
import * as ivRepo from "./interview-comms-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ADMIN_ROLES = ["hr_admin", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });

/**
 * Storage seam: ask the object store to delete the bytes. Not yet wired — we do
 * NOT fake a deletion. The soft-delete + retention record is the source of truth;
 * a real adapter will remove the object and this becomes a no-op call site.
 */
async function purgeObjectStub(storageKey: string, log: FastifyInstance["log"]): Promise<void> {
  log.info({ event: "recording_object_purge_stub", storageKey }, "object-store deletion deferred (storage adapter not wired)");
}

export async function interviewRecordingRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/interviews/:id/recordings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      kind: z.enum(RECORDING_KINDS),
      storageKey: z.string().min(1).max(512),
      consentGiven: z.boolean(),
      consentReference: z.string().max(200).optional(),
      retentionDays: z.coerce.number().int().min(MIN_RETENTION_DAYS).max(MAX_RETENTION_DAYS).optional(),
    }).parse(req.body);

    const iv = await ivRepo.findInterview(ctx.tenantId, id);
    if (!iv) throw new HttpError(404, "NOT_FOUND", "interview not found");

    const errors = validateRecording(body);
    if (errors.length > 0) throw new HttpError(422, "INVALID_RECORDING", errors.join("; "));
    // IDOR guard: the object key must sit inside this interview's namespace.
    const prefix = recordingKeyPrefix(id);
    if (!body.storageKey.startsWith(prefix)) throw new HttpError(422, "INVALID_RECORDING", `storageKey must be within this interview's namespace ('${prefix}')`);

    const rid = randomUUID();
    const retentionUntil = computeRetentionUntil(Date.now(), body.retentionDays ?? DEFAULT_RETENTION_DAYS);
    await publishF3Write(ctx, "recruitment_interview_recording_routes__0", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: rid, interviewId: id, kind: body.kind, retentionUntil, status: "active" }) as any;
  });

  app.get("/v1/hrms/interviews/:id/recordings", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const iv = await ivRepo.findInterview(ctx.tenantId, id);
    if (!iv) throw new HttpError(404, "NOT_FOUND", "interview not found");
    return reply.send({ id, data: await repo.listForInterview(ctx.tenantId, id) });
  });

  app.delete("/v1/hrms/interview-recordings/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const rec = await repo.findRecording(ctx.tenantId, id);
    if (!rec || rec.status !== "active") throw new HttpError(404, "NOT_FOUND", "active recording not found");
    const ok = await publishF3Write(ctx, "recruitment_interview_recording_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    if (!ok) as any throw new HttpError(409, "VERSION_CONFLICT", "the recording changed; reload and retry");
    await purgeObjectStub(rec.storageKey, req.log);
    // Honest status: the record is soft-deleted, but the object-store bytes are
    // only truly purged once the storage adapter is wired — reported as pending,
    // never claimed as done.
    return reply.send({ id, status: "deleted", objectPurge: "pending_adapter" });
  });

  app.get("/v1/hrms/recordings/expired", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ADMIN_ROLES);
    const q = z.object({ asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.query ?? {});
    const asOf = q.asOf ?? new Date().toISOString().slice(0, 10);
    return reply.send({ asOf, data: await repo.listExpired(ctx.tenantId, asOf) });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    // Duplicate active storage key (partial unique index) — a client conflict, not a 500.
    if (String((err as { code?: string }).code) === "23505") {
      return reply.code(409).send({ code: "DUPLICATE_RECORDING", message: "an active recording already exists for this storage key", correlationId });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.code(status).send({ code: (err as { code?: string }).code ?? "BAD_REQUEST", message: err.message, correlationId });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
