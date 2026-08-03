import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * Selection & offer — selection list + waitlist (R-RA-0153).
 *
 *   POST  /v1/hrms/job-openings/:id/selection-lists   create a draft merit list
 *   PUT   /v1/hrms/selection-lists/:id/entries         set ranked selected + waitlist entries (draft only)
 *   POST  /v1/hrms/selection-lists/:id/approve         approve (senior, SoD, validity period)
 *   POST  /v1/hrms/selection-lists/:id/publish         publish an approved list
 *   POST  /v1/hrms/selection-lists/:id/expire          mark a list expired
 *   GET   /v1/hrms/selection-lists/:id                 list + entries (+ within-validity flag)
 *   GET   /v1/hrms/job-openings/:id/selection-lists    lists for a job opening
 *
 * Entries are only editable while draft; a list is approved by an INDEPENDENT
 * senior user (not its creator) with a future validity period, then published.
 */
import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { ENTRY_CATEGORIES, validateEntries, validateApproval, isWithinValidity, type Entry } from "./selection-domain.js";
import * as repo from "./selection-repo.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const SELECTION_ADMIN_ROLES = ["hr_admin", "super_admin"];
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

export async function selectionListRoutes(app: FastifyInstance): Promise<void> {
  // ---- create a draft list ---------------------------------------------
  app.post("/v1/hrms/job-openings/:id/selection-lists", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id: jobOpeningId } = idParam.parse(req.params);
    const body = z.object({ title: z.string().min(1).max(256), vacancies: z.coerce.number().int().min(1) }).parse(req.body);
    const listId = randomUUID();
    await publishF3Write(ctx, "recruitment_selection_routes__0", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id: listId, jobOpeningId, status: "draft", vacancies: body.vacancies }) as any;
  });

  // ---- set the ranked entries (draft only) -----------------------------
  app.put("/v1/hrms/selection-lists/:id/entries", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      entries: z.array(z.object({
        applicationId: z.string().uuid(),
        candidateName: z.string().min(1).max(256),
        category: z.enum(ENTRY_CATEGORIES),
        rank: z.coerce.number().int().min(1),
        score: z.coerce.number().optional(),
        remarks: z.string().max(2000).optional(),
      })).min(1).max(2000),
    }).parse(req.body);
    const list = await mustList(ctx.tenantId, id);
    if (list.status !== "draft") throw new HttpError(409, "NOT_DRAFT", "entries can only be edited while the list is a draft");

    const errors = validateEntries(body.entries.map((e): Entry => ({ applicationId: e.applicationId, category: e.category, rank: e.rank })), list.vacancies);
    if (errors.length > 0) throw new HttpError(422, "INVALID_ENTRIES", errors.join("; "));

    try {
      await publishF3Write(ctx, "recruitment_selection_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    } catch (e) {
      // A concurrent set-entries (double-submit / retry) can collide on the DB
      // unique index after its own DELETE affected 0 rows — surface it cleanly.
      if ((e as { code?: string }).code === "23505") throw new HttpError(409, "ENTRIES_CONFLICT", "the list entries were modified concurrently; reload and retry");
      throw e;
    }
    return reply.send({ id, entries: body.entries.length });
  });

  // ---- approve (senior, SoD, validity) ---------------------------------
  app.post("/v1/hrms/selection-lists/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SELECTION_ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ validUntil: z.string().datetime() }).parse(req.body);
    const list = await mustList(ctx.tenantId, id);
    if (list.status !== "draft") throw new HttpError(409, "NOT_DRAFT", `a ${list.status} list cannot be approved`);
    // Segregation of duties: neither the list creator NOR whoever authored the
    // ranking can approve it — else one person authors and approves the merit list.
    if (list.createdBy === ctx.actorId || (list.entriesSetBy && list.entriesSetBy === ctx.actorId)) {
      throw new HttpError(403, "SOD_VIOLATION", "a user who created the list or authored its ranking cannot approve it; an independent authorised user must approve");
    }
    const vErr = validateApproval(body.validUntil, Date.now());
    if (vErr.length > 0) throw new HttpError(422, "INVALID_VALIDITY", vErr.join("; "));

    const entries = await repo.listEntries(ctx.tenantId, id);
    if (entries.length === 0) throw new HttpError(409, "NO_ENTRIES", "the list has no entries to approve");
    // Re-validate the persisted entries at approval time.
    const errors = validateEntries(entries.map((e): Entry => ({ applicationId: e.applicationId, category: e.category, rank: e.rank })), list.vacancies);
    if (errors.length > 0) throw new HttpError(422, "INVALID_ENTRIES", errors.join("; "));

    const validUntil = new Date(body.validUntil).toISOString().slice(0, 10);
    await publishF3Write(ctx, "recruitment_selection_routes__2", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: "approved", validityUntil: validUntil }) as any;
  });

  // ---- publish ----------------------------------------------------------
  app.post("/v1/hrms/selection-lists/:id/publish", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SELECTION_ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const list = await mustList(ctx.tenantId, id);
    if (list.status !== "approved") throw new HttpError(409, "NOT_APPROVED", "only an approved list can be published");
    await publishF3Write(ctx, "recruitment_selection_routes__3", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: "published" }) as any;
  });

  // ---- expire -----------------------------------------------------------
  app.post("/v1/hrms/selection-lists/:id/expire", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SELECTION_ADMIN_ROLES);
    const { id } = idParam.parse(req.params);
    const list = await mustList(ctx.tenantId, id);
    if (list.status === "expired" || list.status === "draft") throw new HttpError(409, "INVALID_STATE", `a ${list.status} list cannot be expired`);
    await publishF3Write(ctx, "recruitment_selection_routes__4", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: "expired" }) as any;
  });

  app.get("/v1/hrms/selection-lists/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const list = await mustList(ctx.tenantId, id);
    const entries = await repo.listEntries(ctx.tenantId, id);
    return reply.send(jsonSafe({
      ...list,
      withinValidity: list.status === "published" && isWithinValidity(list.validityUntil, Date.now()),
      entries: entries.sort((a, b) => (a.category === b.category ? a.rank - b.rank : a.category < b.category ? -1 : 1)),
    }));
  });

  app.get("/v1/hrms/job-openings/:id/selection-lists", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    return reply.send(jsonSafe({ data: await repo.listByJob(ctx.tenantId, id) }));
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });

  async function mustList(tenantId: string, id: string) {
    const l = await repo.findList(tenantId, id);
    if (!l) throw new HttpError(404, "NOT_FOUND", "selection list not found");
    return l;
  }
}
