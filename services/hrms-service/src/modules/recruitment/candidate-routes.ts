import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Candidate identity & profile (checklist R-RA-0080/0081/0082/0084/0085/0089/0090/0091).
 *
 *   POST /v1/hrms/candidates                       register (draft) — duplicate-checked
 *   POST /v1/hrms/candidates/duplicate-check       check identity keys (no write)
 *   GET  /v1/hrms/candidates/:id                   read (+ completeness)
 *   PATCH /v1/hrms/candidates/:id                  edit (locked fields rejected after submit)
 *   POST /v1/hrms/candidates/:id/education | /employment   add a history record
 *   GET  /v1/hrms/candidates/:id/education | /employment   list
 *   POST /v1/hrms/candidates/:id/submit            submit (requires versioned consent; locks)
 *   POST /v1/hrms/candidates/:id/withdraw          withdraw the profile
 *   POST /v1/hrms/candidates/:id/data-request      record a DPDP data/erasure request
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import {
  normalizeEmail, mobileDedupKey, CATEGORIES, lockedFieldsIn, consentSatisfied, profileCompleteness,
} from "./candidate.js";
import { otpVerificationEnabled, submissionRequiresVerification } from "./otp-verify.js";
import * as repo from "./candidate-repo.js";

// Candidate PII (DOB, reservation category, disability, addresses) is HR-only —
// manager is deliberately NOT included (matches the sibling recruitment modules,
// which never grant manager access to offer/PII data).
const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });

function jsonSafe(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) out[k] = jsonSafe(val);
    return out;
  }
  return v;
}

const profileFields = {
  fullName: z.string().max(200).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  maritalStatus: z.string().max(16).optional(),
  nationality: z.string().max(64).optional(),
  guardianName: z.string().max(200).optional(),
  correspondenceAddress: z.string().max(2000).optional(),
  permanentAddress: z.string().max(2000).optional(),
  category: z.enum(CATEGORIES).optional(),
  subCategory: z.string().max(32).optional(),
  disability: z.boolean().optional(),
  exServiceman: z.boolean().optional(),
  activeResumeRef: z.string().max(512).optional(),
  resumeFingerprint: z.string().max(128).optional(),
};

export async function candidateRoutes(app: FastifyInstance): Promise<void> {
  app.post("/v1/hrms/candidates", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = z.object({
      email: z.string().email(),
      mobile: z.string().max(20).optional(),
      emailVerified: z.boolean().optional(),
      mobileVerified: z.boolean().optional(),
      ...profileFields,
    }).parse(req.body);
    const nEmail = normalizeEmail(body.email);
    const nMobile = mobileDedupKey(body.mobile); // null unless a real 10-digit number
    const dupes = await repo.findDuplicates(ctx.tenantId, {
      normalizedEmail: nEmail, ...(nMobile ? { normalizedMobile: nMobile } : {}),
      ...(body.resumeFingerprint ? { resumeFingerprint: body.resumeFingerprint } : {}),
    });
    if (dupes.length > 0) {
      return reply.code(409).send({ code: "DUPLICATE_CANDIDATE", message: "an active candidate profile already exists", matches: dupes });
    }
    const id = randomUUID();
    try {
      await publishF3Write(ctx, "recruitment_candidate_routes__0", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    } catch (err) {
      if (String((err as { code?: string }).code) === "23505") {
        return reply.code(409).send({ code: "DUPLICATE_CANDIDATE", message: "an active candidate profile already exists" });
      }
      throw err;
    }
    return reply.code(201).send({ id, status: "draft" });
  });

  app.post("/v1/hrms/candidates/duplicate-check", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = z.object({ email: z.string().email().optional(), mobile: z.string().max(20).optional(), resumeFingerprint: z.string().max(128).optional() }).parse(req.body ?? {});
    const dm = mobileDedupKey(body.mobile);
    const matches = await repo.findDuplicates(ctx.tenantId, {
      ...(body.email ? { normalizedEmail: normalizeEmail(body.email) } : {}),
      ...(dm ? { normalizedMobile: dm } : {}),
      ...(body.resumeFingerprint ? { resumeFingerprint: body.resumeFingerprint } : {}),
    });
    return reply.send({ duplicate: matches.length > 0, matches });
  });

  app.get("/v1/hrms/candidates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const c = await mustCand(ctx.tenantId, id);
    const [eduN, empN] = await Promise.all([repo.countEducation(ctx.tenantId, id), repo.countEmployment(ctx.tenantId, id)]);
    const completeness = profileCompleteness({
      fullName: c.fullName, dateOfBirth: c.dateOfBirth, email: c.email, mobile: c.mobile,
      category: c.category, educationCount: eduN, employmentCount: empN, activeResume: c.activeResumeRef,
    });
    return reply.send(jsonSafe({ ...c, educationCount: eduN, employmentCount: empN, completeness }));
  });

  app.patch("/v1/hrms/candidates/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object(profileFields).parse(req.body ?? {});
    const c = await mustCand(ctx.tenantId, id);
    if (c.status === "withdrawn") throw new HttpError(409, "WITHDRAWN", "a withdrawn profile cannot be edited");
    const requested = Object.keys(body).filter((k) => (body as Record<string, unknown>)[k] !== undefined);
    const locked = lockedFieldsIn(c.status, requested);
    if (locked.length > 0) throw new HttpError(409, "FIELDS_LOCKED", `these fields are locked after submission: ${locked.join(", ")}`);
    const patch: Record<string, unknown> = { updatedBy: ctx.actorId, ...pick(body) };
    await publishF3Write(ctx, "recruitment_candidate_routes__1", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: c.status });
  });

  app.post("/v1/hrms/candidates/:id/education", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      qualification: z.string().min(1).max(120), subject: z.string().max(200).optional(),
      institution: z.string().max(200).optional(), boardUniversity: z.string().max(200).optional(),
      yearOfPassing: z.coerce.number().int().min(1900).max(2100).optional(),
      marksPercent: z.coerce.number().min(0).max(100).optional(), grade: z.string().max(16).optional(),
    }).parse(req.body);
    const c = await mustCand(ctx.tenantId, id);
    if (c.status !== "draft") throw new HttpError(409, "LOCKED", "history can only be added while the profile is a draft");
    const eid = randomUUID();
    await publishF3Write(ctx, "recruitment_candidate_routes__2", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: eid, candidateId: id });
  });

  app.post("/v1/hrms/candidates/:id/employment", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      employer: z.string().min(1).max(200), roleTitle: z.string().max(200).optional(),
      fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      noticePeriodDays: z.coerce.number().int().min(0).max(365).optional(),
      ctcMinor: z.coerce.number().int().min(0).optional(), reasonForLeaving: z.string().max(2000).optional(),
    }).parse(req.body);
    const c = await mustCand(ctx.tenantId, id);
    if (c.status !== "draft") throw new HttpError(409, "LOCKED", "history can only be added while the profile is a draft");
    const eid = randomUUID();
    await publishF3Write(ctx, "recruitment_candidate_routes__3", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: eid, candidateId: id });
  });

  app.get("/v1/hrms/candidates/:id/education", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(jsonSafe({ data: await repo.listEducation(ctx.tenantId, id) }));
  });
  app.get("/v1/hrms/candidates/:id/employment", async (req, reply) => {
    const ctx = resolveContext(req); requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(jsonSafe({ data: await repo.listEmployment(ctx.tenantId, id) }));
  });

  app.post("/v1/hrms/candidates/:id/submit", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ consentVersion: z.string().min(1).max(24).optional(), consentAccepted: z.boolean().optional() }).parse(req.body ?? {});
    const c = await mustCand(ctx.tenantId, id);
    if (c.status !== "draft") throw new HttpError(409, "WRONG_STATE", `profile is '${c.status}', not a draft`);
    if (!consentSatisfied(body)) throw new HttpError(400, "CONSENT_REQUIRED", "a versioned consent must be accepted to submit the profile");
    // DEF-RC-003: when OTP verification is enabled, email must be verified before
    // submission (the candidate proved they own the contact address).
    if (submissionRequiresVerification(otpVerificationEnabled(process.env), c.emailVerified)) {
      throw new HttpError(422, "EMAIL_NOT_VERIFIED", "email must be verified (OTP) before the profile can be submitted");
    }
    await publishF3Write(ctx, "recruitment_candidate_routes__4", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: "submitted", consentVersion: body.consentVersion });
  });

  app.post("/v1/hrms/candidates/:id/withdraw", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const c = await mustCand(ctx.tenantId, id);
    if (c.status === "withdrawn") throw new HttpError(409, "ALREADY_WITHDRAWN", "profile is already withdrawn");
    await publishF3Write(ctx, "recruitment_candidate_routes__5", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: "withdrawn" });
  });

  app.post("/v1/hrms/candidates/:id/data-request", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const c = await mustCand(ctx.tenantId, id);
    await publishF3Write(ctx, "recruitment_candidate_routes__6", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, dataRequestRecorded: true });
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

  async function mustCand(tenantId: string, id: string) {
    const c = await repo.findCandidate(tenantId, id);
    if (!c) throw new HttpError(404, "NOT_FOUND", "candidate not found");
    return c;
  }
}

/** Pass through the profile fields present in `body` to a DB patch object. */
function pick(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ["fullName", "dateOfBirth", "gender", "maritalStatus", "nationality", "guardianName",
    "correspondenceAddress", "permanentAddress", "category", "subCategory", "disability", "exServiceman",
    "activeResumeRef", "resumeFingerprint"]) {
    if (body[k] !== undefined) out[k] = body[k];
  }
  return out;
}
