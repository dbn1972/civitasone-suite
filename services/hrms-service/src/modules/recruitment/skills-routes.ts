import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Candidate professional profile — skills, certifications, languages and
 * credentials (publications/patents/memberships/awards). R-RA-0086.
 *
 *   PUT /v1/hrms/candidates/:id/skills
 *   PUT /v1/hrms/candidates/:id/certifications
 *   PUT /v1/hrms/candidates/:id/languages
 *   PUT /v1/hrms/candidates/:id/credentials
 *   GET /v1/hrms/candidates/:id/professional-profile
 *
 * Each section is a full replacement, draft-only (a submitted profile is locked).
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import {
  PROFICIENCY_LEVELS, LANGUAGE_PROFICIENCY, CREDENTIAL_KINDS,
  validateSkills, validateCertifications, validateLanguages, validateCredentials,
  type Skill, type Certification, type Language, type Credential,
} from "./skills-domain.js";
import * as candidateRepo from "./candidate-repo.js";
import * as repo from "./skills-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const idParam = z.object({ id: z.string().uuid() });

export async function candidateSkillsRoutes(app: FastifyInstance): Promise<void> {
  app.put("/v1/hrms/candidates/:id/skills", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ skills: z.array(z.object({
      skill: z.string().min(1).max(120), proficiency: z.enum(PROFICIENCY_LEVELS), yearsExperience: z.coerce.number().min(0).max(80).optional(),
    })).max(200) }).parse(req.body);
    await mustDraft(ctx.tenantId, id);
    const errors = validateSkills(body.skills as Skill[]);
    if (errors.length > 0) throw new HttpError(422, "INVALID_SKILLS", errors.join("; "));
    await publishF3Write(ctx, "recruitment_skills_routes__0", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, skills: body.skills.length });
  });

  app.put("/v1/hrms/candidates/:id/certifications", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ certifications: z.array(z.object({
      name: z.string().min(1).max(200), issuer: z.string().min(1).max(200),
      issueDate: z.string().date().optional(), expiryDate: z.string().date().optional(),
      credentialId: z.string().max(120).optional(), credentialUrl: z.string().max(512).optional(),
    })).max(100) }).parse(req.body);
    await mustDraft(ctx.tenantId, id);
    const errors = validateCertifications(body.certifications as Certification[], Date.now());
    if (errors.length > 0) throw new HttpError(422, "INVALID_CERTIFICATIONS", errors.join("; "));
    await publishF3Write(ctx, "recruitment_skills_routes__1", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, certifications: body.certifications.length });
  });

  app.put("/v1/hrms/candidates/:id/languages", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ languages: z.array(z.object({
      language: z.string().min(1).max(64), canRead: z.boolean().default(false), canWrite: z.boolean().default(false), canSpeak: z.boolean().default(false),
      proficiency: z.enum(LANGUAGE_PROFICIENCY).optional(),
    })).max(50) }).parse(req.body);
    await mustDraft(ctx.tenantId, id);
    const errors = validateLanguages(body.languages as Language[]);
    if (errors.length > 0) throw new HttpError(422, "INVALID_LANGUAGES", errors.join("; "));
    await publishF3Write(ctx, "recruitment_skills_routes__2", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, languages: body.languages.length });
  });

  app.put("/v1/hrms/candidates/:id/credentials", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ credentials: z.array(z.object({
      kind: z.enum(CREDENTIAL_KINDS), title: z.string().min(1).max(300), detail: z.string().max(4000).optional(),
      year: z.coerce.number().int().optional(), referenceUrl: z.string().max(512).optional(),
    })).max(200) }).parse(req.body);
    await mustDraft(ctx.tenantId, id);
    const errors = validateCredentials(body.credentials as Credential[], Date.now());
    if (errors.length > 0) throw new HttpError(422, "INVALID_CREDENTIALS", errors.join("; "));
    await publishF3Write(ctx, "recruitment_skills_routes__3", (typeof id === "string" ? id : randomUUID()), { body: (typeof body !== "undefined" ? body : (req.body as Record<string, unknown>)), params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, credentials: body.credentials.length });
  });

  app.get("/v1/hrms/candidates/:id/professional-profile", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    await mustCandidate(ctx.tenantId, id);
    const [skills, certifications, languages, credentials] = await Promise.all([
      repo.listSkills(ctx.tenantId, id), repo.listCertifications(ctx.tenantId, id),
      repo.listLanguages(ctx.tenantId, id), repo.listCredentials(ctx.tenantId, id),
    ]);
    return reply.send({ id, skills, certifications, languages, credentials });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });

  async function mustCandidate(tenantId: string, id: string) {
    const c = await candidateRepo.findCandidate(tenantId, id);
    if (!c) throw new HttpError(404, "NOT_FOUND", "candidate not found");
    return c;
  }
  async function mustDraft(tenantId: string, id: string) {
    const c = await mustCandidate(tenantId, id);
    if (c.status !== "draft") throw new HttpError(409, "LOCKED", "the profile is locked after submission and can only be edited while a draft");
    return c;
  }
}
