import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
/**
 * APAR / SPARROW multi-authority workflow.
 *
 * Stage chain (status column on appraisal.hrms_appraisals):
 *   self_pending        -> officer submits self-appraisal
 *   reporting_officer   -> Reporting Officer scores attributes (1..10) + pen-picture
 *   reviewing_officer   -> Reviewing Officer concurrence / variation
 *   accepting_authority -> Accepting Authority finalises; server computes grade+band
 *   disclosed           -> grade disclosed to officer; representation window opens
 *   representation      -> officer files representation (optional)
 *   finalised           -> closed
 *
 * Separation-of-duties: every transition asserts the acting actor IS the
 * officer assigned to the *current* stage. Out-of-turn actors are rejected
 * with 403. An immutable stage-history row is appended on every transition.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import type { RequestContext } from "@civitasone/types";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db } from "../../shared/db.js";
import { writeAuditLog } from "../../shared/audit.js";
import * as repo from "./repo.js";
import { computeOverallGrade, type ScoreInput } from "./engine.js";
import type { AppraisalRow } from "../appraisals/schema.js";
import type { AparScoreRow } from "./schema.js";
import { resolveEmployeeForActor } from "../employee/actor-link.js";
import { getPolicy } from "../policy-settings/repo.js";
import { aparDeadline } from "./deadlines.js";
// GAP-HR-APAR-02 / GAP-HR-APAR-DETAIL-02 / GAP-HR-APAR-DETAIL-04: the
// shared batch id->name resolver this whole lane was cross-blocked on
// (3-way circular depends_on with GAP-HR-ADVANCES-01, see that gap's own
// catalog entry). GAP-HR-ADVANCES-01 (PR #1698, merged) proved this helper
// safe to reuse without ever touching apar/ itself -- it already lived on
// main before that PR -- so this is the first APAR consumer of it.
import { batchEmployees } from "../../shared/batch-resolve.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin"];
const ACTOR_ROLES = [...HR_ROLES, "manager", "employee"];
const idParam = z.object({ id: z.string().uuid() });

/**
 * Returns the hrms_employees.id (NOT an actor id -- see resolveAparReadScope
 * below) that is authorised to act on the appraisal's current stage.
 * super_admin / hr_admin always bypass (they administer the workflow),
 * mirroring the internal-bypass grants used for verification.
 */
export function stageOwner(a: AppraisalRow): { stage: string; ownerId: string | null } {
  switch (a.status) {
    case "self_pending":        return { stage: a.status, ownerId: a.employeeId };
    case "reporting_officer":   return { stage: a.status, ownerId: a.reportingOfficerId };
    case "reviewing_officer":   return { stage: a.status, ownerId: a.reviewingOfficerId };
    case "accepting_authority": return { stage: a.status, ownerId: a.acceptingAuthorityId };
    case "disclosed":           return { stage: a.status, ownerId: a.employeeId };
    case "representation":      return { stage: a.status, ownerId: a.employeeId };
    default:                    return { stage: a.status, ownerId: null };
  }
}

/**
 * Separation-of-duties guard for a stage transition. Returns whether the action
 * was performed as a privileged override (recorded in stage-history). (C2)
 *
 * Rules:
 *  - The default authorisation is identity-based: the acting actor MUST BE the
 *    officer assigned to the current stage. Holding hr_admin/super_admin role is
 *    NOT by itself sufficient to enter/alter scores or decisions — that would
 *    collapse the four-eyes chain.
 *  - A super_admin (and ONLY super_admin) may act as an explicit override when
 *    they are not the assigned owner; the caller records override=true plus the
 *    true actor id/role in stage-history. hr_admin gets NO scoring override.
 *  - The appraisee can NEVER act on an officer stage (reporting/reviewing/
 *    accepting), even with an admin role.
 *
 * `stageOwner()`'s ownerId is an hrms_employees.id, not an actor id (same
 * mismatch as resolveAparReadScope below), so the acting actor is resolved
 * to their OWN hrms_employees.id first (via resolveEmployeeForActor, keyed
 * on userRef with the established email-fallback/auto-link) and THAT is
 * compared against ownerId/a.employeeId -- never ctx.actorId directly. A
 * caller with no resolvable employee link simply cannot be the owner
 * (fails closed into the super_admin-override-or-403 path below), the same
 * fail-closed posture as the read-scope resolution.
 */
export async function assertStageOwner(ctx: RequestContext, req: FastifyRequest, a: AppraisalRow, expected: string): Promise<{ override: boolean }> {
  if (a.status !== expected) {
    throw new HttpError(409, "WRONG_STAGE", `appraisal is at stage '${a.status}', expected '${expected}'`);
  }
  const { ownerId } = stageOwner(a);
  const actingEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
  const actingEmployeeId = actingEmp?.id ?? null;
  const isOwner = ownerId !== null && actingEmployeeId !== null && actingEmployeeId === ownerId;
  if (isOwner) return { override: false };

  // Not the owner. Officer stages must never be performed by the appraisee, and
  // only super_admin may override; hr_admin may not silently enter scores.
  const OFFICER_STAGES = new Set(["reporting_officer", "reviewing_officer", "accepting_authority"]);
  if (OFFICER_STAGES.has(expected) && actingEmployeeId !== null && actingEmployeeId === a.employeeId) {
    throw new HttpError(403, "SELF_REVIEW_FORBIDDEN",
      `the appraisee cannot act as the officer for stage '${expected}'`);
  }
  if (ctx.roles.includes("super_admin")) {
    return { override: true }; // explicit, audited privileged override
  }
  throw new HttpError(403, "NOT_STAGE_OWNER",
    `actor is not the assigned owner of stage '${expected}'`);
}

/**
 * GAP-HR-APAR-DETAIL-01: read-only mirror of `assertStageOwner`'s decision
 * for the detail page, so the web layer never has to guess ownership
 * itself (fix step 1). Unlike `assertStageOwner` this never throws -- it
 * reports what the CURRENT actor could do, for the UI to decide what form
 * (if any) to render.
 *
 * Two independent action slots, because `disclosed`/`representation` both
 * admit two different next actors (the appraisee may file a
 * representation; HR may finalise directly, even skipping representation
 * -- see the `/finalise` route's own `WRONG_STAGE` check): `stage` covers
 * the identity-owned stage-chain action (self-appraisal / reporting /
 * reviewing / accept / representation), `canFinalise` covers the
 * separate, role-based (not identity-based) HR finalise action. A viewer
 * can see both as `true` if applicable (hr_admin who also happens to be
 * stage owner is vanishingly unlikely in practice but not excluded), or
 * neither.
 */
async function computeAparActions(
  ctx: RequestContext,
  a: AppraisalRow,
  actingEmployeeId: string | null,
): Promise<{ expectedStage: string; canAct: boolean; isOverride: boolean; canFinalise: boolean }> {
  const canFinalise = HR_ROLES.some((r) => ctx.roles.includes(r))
    && (a.status === "disclosed" || a.status === "representation");

  if (a.status === "finalised") {
    return { expectedStage: a.status, canAct: false, isOverride: false, canFinalise: false };
  }

  const { ownerId } = stageOwner(a);
  const isOwner = ownerId !== null && actingEmployeeId !== null && actingEmployeeId === ownerId;
  if (isOwner) {
    return { expectedStage: a.status, canAct: true, isOverride: false, canFinalise };
  }

  const OFFICER_STAGES = new Set(["reporting_officer", "reviewing_officer", "accepting_authority"]);
  if (OFFICER_STAGES.has(a.status) && actingEmployeeId !== null && actingEmployeeId === a.employeeId) {
    // Mirrors assertStageOwner's SELF_REVIEW_FORBIDDEN: the appraisee can
    // never act as their own officer, not even via super_admin override.
    return { expectedStage: a.status, canAct: false, isOverride: false, canFinalise };
  }
  if (ctx.roles.includes("super_admin")) {
    return { expectedStage: a.status, canAct: true, isOverride: true, canFinalise };
  }
  return { expectedStage: a.status, canAct: false, isOverride: false, canFinalise };
}

/**
 * The TRUE role of the acting actor for stage-history (C2). We record the
 * functional stage role only when the actor genuinely owns the stage; on a
 * privileged override we record the actor's real elevated role so history is
 * never falsified.
 */
function trueActorRole(ctx: RequestContext, functionalRole: string, override: boolean): string {
  if (!override) return functionalRole;
  if (ctx.roles.includes("super_admin")) return "super_admin";
  if (ctx.roles.includes("hr_admin")) return "hr_admin";
  return ctx.roles[0] ?? functionalRole;
}

/**
 * Read-scope for GET /v1/hrms/apar (list) and GET /v1/hrms/apar/:id (detail)
 * ONLY. The stage-transition (POST) routes below do NOT use this — they rely
 * entirely on assertStageOwner's per-stage ownership chain, which is already
 * separately audited and must not be narrowed by this read-only visibility
 * scope (e.g. a reporting officer must still be able to act on a stage even
 * when they are not the employee's people-manager).
 *
 * Returns:
 *  - null      caller holds an HR_ROLES role (hr_admin/hr_officer/
 *              super_admin) — unrestricted, tenant-wide, matching the
 *              "HR sees all" comment on the list route below.
 *  - string[]  caller is "employee" and/or "manager" — the set of
 *              `employeeId` values this caller may read. `hrms_appraisals.
 *              employeeId` is an hrms_employees.id (the row HR picked via
 *              the employee picker on create — see apar/repo.ts's
 *              listAppraisals doc comment), NOT the acting actor's id, so
 *              the caller is resolved to their OWN hrms_employees.id first
 *              (resolveEmployeeForActor, keyed on userRef) before building
 *              this set: their own resolved employee id ("employee" role)
 *              unioned with their direct reports' employee ids ("manager"
 *              role, via hrms_employees.managerId — the same reporting-line
 *              relationship employee/routes.ts's resolveManagerScope uses).
 *              An empty array means the caller can read nothing — e.g. an
 *              employee/manager caller with no resolvable hrms_employees
 *              link, which fails CLOSED rather than falling back to "see
 *              everyone", mirroring resolveManagerScope's `null` case.
 */
async function resolveAparReadScope(ctx: RequestContext, req: FastifyRequest): Promise<string[] | null> {
  if (HR_ROLES.some((r) => ctx.roles.includes(r))) return null;

  const allowed = new Set<string>();
  const needsOwnEmployee = ctx.roles.includes("employee") || ctx.roles.includes("manager");
  // Resolved once and shared: an actor holding both "employee" and
  // "manager" roles must not pay for (or risk divergent results from) two
  // separate lookups of their own record.
  const ownEmp = needsOwnEmployee
    ? await resolveEmployeeForActor(ctx.tenantId, ctx.actorId)
    : undefined;

  if (ctx.roles.includes("employee") && ownEmp) {
    allowed.add(ownEmp.id);
  }
  if (ctx.roles.includes("manager") && ownEmp) {
    const reports = await repo.listDirectReportEmployeeIds(ctx.tenantId, ownEmp.id);
    for (const employeeId of reports) allowed.add(employeeId);
  }
  // No resolvable employee link for this caller -> contributes nothing;
  // fails CLOSED rather than granting tenant-wide (or any) visibility.
  return [...allowed];
}

/**
 * Single-record guard for GET /:id. Rejects with 404 (not 403) so an
 * out-of-scope caller cannot distinguish "exists but isn't yours" from
 * "does not exist" — this is a lookup by id (unlike the list route, which
 * filters), so Bug 2 calls for reject/404 rather than filtering.
 *
 * GAP-HR-APAR-DETAIL-01 fix: `scope` (resolveAparReadScope) is manager-
 * relationship-based -- "HR", "the appraisee", or "the appraisee's
 * hrms_employees.managerId". That alone would 404 a Reviewing Officer or
 * Accepting Authority who is validly assigned to THIS record's officer
 * chain but has no people-manager relationship to the appraisee at all
 * (the normal case for those two roles -- they are typically senior to,
 * not the line manager of, the appraisee). Caught by this route's own
 * computeAparActions test: a reporting officer with no manager link to
 * the appraisee got 404 before ever reaching the stage-action UI this
 * gap built. An assigned officer is an equally valid reason to read the
 * record they are named on, same principle assertStageOwner already
 * applies on the write side (see that function's own doc comment).
 */
function assertReadable(scope: string[] | null, a: AppraisalRow, actingEmployeeId: string | null): void {
  if (scope === null || scope.includes(a.employeeId)) return;
  const officerIds = [a.reportingOfficerId, a.reviewingOfficerId, a.acceptingAuthorityId];
  if (actingEmployeeId !== null && officerIds.includes(actingEmployeeId)) return;
  throw new HttpError(404, "NOT_FOUND", "appraisal not found");
}

/** Statuses reached before the grade/pen-picture/remarks are disclosed to the appraisee. */
const PRE_DISCLOSURE_STATUSES = new Set(["self_pending", "reporting_officer", "reviewing_officer", "accepting_authority"]);

/**
 * GAP-HR-APAR-DETAIL-03: the appraisee must not see the Reporting Officer's
 * pen-picture, the Reviewing/Accepting officers' remarks, the computed
 * grade/band, or any score's freetext remarks until the record is actually
 * disclosed to them — that is the whole point of the DoPT confidential
 * report process (disclosure is its own stage transition). Every other
 * reader (an officer party to the case, or an HR role) sees the row in
 * full; `assertReadable` above already keeps an unrelated employee/manager
 * from reaching this appraisal at all, so the only redaction case left is
 * "the appraisee, reading their own not-yet-disclosed record".
 */
function redactForAppraiseePreDisclosure(
  a: AppraisalRow,
  scores: AparScoreRow[],
  isAppraisee: boolean,
): { appraisal: AppraisalRow; scores: AparScoreRow[] } {
  if (!isAppraisee || !PRE_DISCLOSURE_STATUSES.has(a.status)) {
    return { appraisal: a, scores };
  }
  return {
    appraisal: {
      ...a,
      reportingPenPicture: null,
      reviewingRemarks: null,
      acceptingRemarks: null,
      overallGrade: null,
      overallBand: null,
    },
    scores: scores.map((s) => ({ ...s, remarks: null })),
  };
}

export async function aparRoutes(app: FastifyInstance): Promise<void> {
  // --- list APARs for tenant (HR sees all; employee sees own) -----------------
  // GAP-HR-APAR-06: optional ?status=/?period= exact-match filters, and a
  // `limit`/`offset` pair (default 100/0, same default as before when
  // omitted). Response now also carries `total` (matching rows regardless
  // of limit/offset), `hasMore`, and server-side `counts` for the list
  // page's stat cards — see repo.ts's countAparsByStatusGroup doc comment
  // for why `counts` ignores status/period (it describes the whole scoped
  // population, not the current filter's result).
  app.get("/v1/hrms/apar", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ACTOR_ROLES);
    const q = z.object({
      status: z.string().max(24).optional(),
      period: z.string().min(1).max(16).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);
    const scope = await resolveAparReadScope(ctx, req);
    // exactOptionalPropertyTypes: only assign status/period when actually
    // present -- ListAppraisalsOptions' fields are optional (key may be
    // omitted) but not nullable-to-undefined (an explicit `status: undefined`
    // is a type error under this tsconfig, same convention already used by
    // seniority/routes.ts's resolveManagerDepartmentScope filter object).
    const listOpts: repo.ListAppraisalsOptions = { limit: q.limit, offset: q.offset };
    if (q.status) listOpts.status = q.status;
    if (q.period) listOpts.period = q.period;
    const [{ rows, total }, counts] = await Promise.all([
      repo.listAppraisals(ctx.tenantId, scope, listOpts),
      repo.countAparsByStatusGroup(ctx.tenantId, scope),
    ]);
    // GAP-HR-APAR-02: resolve employeeId (and the three officer ids, so the
    // card can also show the current stage owner's name) to display names
    // in one batched lookup -- never a raw UUID in the response. Tenant-
    // scoped, read-only enrichment; does not touch the list's own
    // scope/filter logic above. An id with no match (e.g. a stale/deleted
    // employee) simply has no entry in the map -- the web layer already
    // falls back to a translated "unavailable" string, never the UUID.
    const ids = rows.flatMap((r) => [r.employeeId, r.reportingOfficerId, r.reviewingOfficerId, r.acceptingAuthorityId]);
    const names = await batchEmployees(ctx.tenantId, ids);
    // GAP-HR-APAR-03: per-stage due date from the tenant's apar_deadlines policy.
    const deadlinePolicy = await getPolicy(ctx.tenantId, "apar_deadlines");
    const enriched = rows.map((r) => ({
      ...r,
      deadline: aparDeadline(r, deadlinePolicy),
      employeeName: names.get(r.employeeId)?.fullName,
      employeeNo: names.get(r.employeeId)?.employeeNo,
      reportingOfficerName: r.reportingOfficerId ? names.get(r.reportingOfficerId)?.fullName : undefined,
      reviewingOfficerName: r.reviewingOfficerId ? names.get(r.reviewingOfficerId)?.fullName : undefined,
      acceptingAuthorityName: r.acceptingAuthorityId ? names.get(r.acceptingAuthorityId)?.fullName : undefined,
    }));
    return reply.send({
      data: enriched,
      total,
      hasMore: q.offset + rows.length < total,
      counts,
    });
  });

  // --- create APAR with the full officer chain assigned ---------------------
  app.post("/v1/hrms/apar", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = z.object({
      employeeId: z.string().uuid(),
      // GAP-HR-APAR-NEW-04: canonical Indian financial-year format only
      // ("2025-26", never "2025-2026"/"FY26") -- the second pair must be
      // (first year + 1) mod 100, so "2025-27" is also rejected.
      appraisalPeriod: z.string().regex(/^\d{4}-\d{2}$/, "appraisal period must be in YYYY-YY financial-year format, e.g. 2025-26")
        .refine((v) => {
          const [y1, y2] = v.split("-").map(Number);
          if (y1 === undefined || y2 === undefined) return false;
          return (y1 + 1) % 100 === y2;
        }, { message: "appraisal period must be consecutive financial years, e.g. 2025-26" }),
      reportingOfficerId: z.string().uuid(),
      reviewingOfficerId: z.string().uuid(),
      acceptingAuthorityId: z.string().uuid(),
    }).parse(req.body);
    // H1: the appraisee cannot be any of their own officers, and the three
    // officers must be distinct (no one person holds two stages).
    const officers = [body.reportingOfficerId, body.reviewingOfficerId, body.acceptingAuthorityId];
    if (officers.includes(body.employeeId)) {
      throw new HttpError(400, "SELF_OFFICER_FORBIDDEN",
        "the appraisee cannot be their own reporting/reviewing/accepting officer");
    }
    if (new Set(officers).size !== officers.length) {
      throw new HttpError(400, "OFFICERS_NOT_DISTINCT",
        "reporting, reviewing and accepting officers must be three distinct people");
    }
    // GAP-HR-APAR-NEW-04: synchronous pre-check for one-APAR-per-employee-
    // per-period, same "check before queuing" shape as the other
    // synchronous guards in this codebase (e.g. employee/routes.ts's
    // confirmEmployee status check) -- creation itself is queued
    // (publishF3Write below), so without this the caller would only learn
    // about a duplicate after the fact, if ever. Deliberately app-level
    // only, no DB unique constraint/migration: the fix-step's own Risk note
    // says a unique index could fail against existing production data this
    // snapshot cannot inspect ("check before migrating") -- this check is
    // the safe subset that does not require one.
    const existing = await repo.findAppraisalByEmployeeAndPeriod(ctx.tenantId, body.employeeId, body.appraisalPeriod);
    if (existing) {
      throw new HttpError(409, "DUPLICATE_APAR",
        `an APAR for this employee and period '${body.appraisalPeriod}' already exists`);
    }
    const id = randomUUID();
    await publishF3Write(ctx, "apar_routes__0", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id, status: "self_pending" }) as any;
  });

  // --- stage 1: officer submits self-appraisal -> reporting_officer ---------
  app.post("/v1/hrms/apar/:id/self-appraisal", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ACTOR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ selfAppraisal: z.string().min(1).max(8000) }).parse(req.body);
    const a = await mustFind(id, ctx.tenantId);
    const { override } = await assertStageOwner(ctx, req, a, "self_pending");
    await publishF3Write(ctx, "apar_routes__1", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: "reporting_officer" }) as any;
  });

  // --- stage 2: reporting officer scores + pen-picture -> reviewing_officer -
  app.post("/v1/hrms/apar/:id/reporting", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ACTOR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      penPicture: z.string().min(1).max(8000),
      scores: z.array(z.object({
        attribute: z.string().min(1).max(64),
        weight: z.number().positive().max(100).default(1),
        score: z.number().int().min(1).max(10),
        remarks: z.string().max(2000).optional(),
      })).min(1).refine(
        (arr) => arr.reduce((s, w) => s + w.weight, 0) === 100,
        { message: "KRA weights must sum to 100" },
      ),
    }).parse(req.body);
    const a = await mustFind(id, ctx.tenantId);
    const { override } = await assertStageOwner(ctx, req, a, "reporting_officer");
    await publishF3Write(ctx, "apar_routes__2", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: "reviewing_officer" }) as any;
  });

  // --- stage 3: reviewing officer concurrence/variation -> accepting --------
  app.post("/v1/hrms/apar/:id/reviewing", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ACTOR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({
      decision: z.enum(["concur", "vary"]),
      remarks: z.string().min(1).max(8000),
      // optional per-attribute variation: attribute -> new score
      variations: z.array(z.object({
        attribute: z.string().min(1).max(64),
        score: z.number().int().min(1).max(10),
      })).optional(),
    }).parse(req.body);
    const a = await mustFind(id, ctx.tenantId);
    const { override } = await assertStageOwner(ctx, req, a, "reviewing_officer");
    await publishF3Write(ctx, "apar_routes__3", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: "accepting_authority", decision: body.decision }) as any;
  });

  // --- stage 4: accepting authority finalises; grade computed server-side ---
  app.post("/v1/hrms/apar/:id/accept", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ACTOR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ remarks: z.string().min(1).max(8000) }).parse(req.body);
    const a = await mustFind(id, ctx.tenantId);
    const { override } = await assertStageOwner(ctx, req, a, "accepting_authority");
    const scoreRows = await repo.listScores(ctx.tenantId, id);
    if (scoreRows.length === 0) throw new HttpError(409, "NO_SCORES", "no attribute scores to grade");
    const scores: ScoreInput[] = scoreRows.map((s) => ({
      attribute: s.attribute, weight: Number(s.weight), score: s.score,
    }));
    const grade = computeOverallGrade(scores);
    await publishF3Write(ctx, "apar_routes__4", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: "disclosed", overallGrade: grade.overallGrade, band: grade.band }) as any;
  });

  // --- stage 5: officer files representation (optional) ---------------------
  app.post("/v1/hrms/apar/:id/representation", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ACTOR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = z.object({ representation: z.string().min(1).max(8000) }).parse(req.body);
    const a = await mustFind(id, ctx.tenantId);
    const { override } = await assertStageOwner(ctx, req, a, "disclosed");
    await publishF3Write(ctx, "apar_routes__5", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: "representation" }) as any;
  });

  // --- finalise (HR closes; from disclosed or representation) ---------------
  app.post("/v1/hrms/apar/:id/finalise", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const a = await mustFind(id, ctx.tenantId);
    if (a.status !== "disclosed" && a.status !== "representation") {
      throw new HttpError(409, "WRONG_STAGE", `cannot finalise from '${a.status}'`);
    }
    await publishF3Write(ctx, "apar_routes__6", randomUUID(), { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.send({ id, status: "finalised", overallGrade: a.overallGrade, band: a.overallBand }) as any;
  });

  // --- read: full APAR with scores + stage history --------------------------
  app.get("/v1/hrms/apar/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ACTOR_ROLES);
    const { id } = idParam.parse(req.params);
    const a = await mustFind(id, ctx.tenantId);
    const scope = await resolveAparReadScope(ctx, req);
    // Resolved once, regardless of role, and BEFORE assertReadable: needed
    // both for that officer-on-this-record read-access check (GAP-HR-APAR-
    // DETAIL-01 fix, see assertReadable's own doc comment) and for the
    // appraisee redaction check and computeAparActions below -- an HR
    // viewer can, in principle, also be a named officer on this very
    // record, so this is not conditioned on `scope` the way the old
    // appraisee-only check was.
    const actingEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
    const actingEmployeeId = actingEmp?.id ?? null;
    assertReadable(scope, a, actingEmployeeId);
    const [scores, history] = await Promise.all([
      repo.listScores(ctx.tenantId, id),
      repo.listHistory(ctx.tenantId, id),
    ]);

    // GAP-HR-APAR-DETAIL-03: redact officer-only fields from the appraisee's
    // own view until disclosure. HR/officers (anyone resolveAparReadScope
    // gave unrestricted `null` scope to) always see the full record.
    const isAppraisee = scope !== null && actingEmployeeId === a.employeeId;
    const redacted = redactForAppraiseePreDisclosure(a, scores, isAppraisee);

    // GAP-HR-APAR-DETAIL-01: so the web layer never has to guess ownership
    // (see computeAparActions's own doc comment for the two-action-slot
    // shape).
    const actions = await computeAparActions(ctx, a, actingEmployeeId);

    // GAP-HR-APAR-DETAIL-02 / DETAIL-04: resolve the employee + three
    // officer ids, plus every history row's actorId, to display names in
    // one batched lookup -- never a raw UUID anywhere on this page. Same
    // helper and circular-dependency resolution as GAP-HR-APAR-02 above
    // (see that route's comment).
    const ids = [a.employeeId, a.reportingOfficerId, a.reviewingOfficerId, a.acceptingAuthorityId, ...history.map((h) => h.actorId)];
    const names = await batchEmployees(ctx.tenantId, ids);
    const enrichedAppraisal = {
      ...redacted.appraisal,
      employeeName: names.get(redacted.appraisal.employeeId)?.fullName,
      employeeNo: names.get(redacted.appraisal.employeeId)?.employeeNo,
      reportingOfficerName: redacted.appraisal.reportingOfficerId ? names.get(redacted.appraisal.reportingOfficerId)?.fullName : undefined,
      reviewingOfficerName: redacted.appraisal.reviewingOfficerId ? names.get(redacted.appraisal.reviewingOfficerId)?.fullName : undefined,
      acceptingAuthorityName: redacted.appraisal.acceptingAuthorityId ? names.get(redacted.appraisal.acceptingAuthorityId)?.fullName : undefined,
    };
    const enrichedHistory = history.map((h) => ({ ...h, actorName: names.get(h.actorId)?.fullName }));

    // GAP-HR-APAR-DETAIL-07 (DPDP): data-access audit event on every read of
    // a named appraisal record. writeAuditLog is fire-and-forget and never
    // throws (see shared/audit.ts) -- a logging failure must never turn a
    // successful read into a 500.
    await writeAuditLog({
      tenantId: ctx.tenantId,
      actorId: ctx.actorId,
      actorType: null,
      actorRoles: ctx.roles,
      method: req.method,
      path: req.url,
      statusCode: 200,
      requestId: (req.headers["x-correlation-id"] as string) ?? req.id,
      ipAddr: req.ip,
    });

    return reply.send({ appraisal: enrichedAppraisal, scores: redacted.scores, history: enrichedHistory, actions });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}

async function mustFind(id: string, tenantId: string): Promise<AppraisalRow> {
  const a = await repo.findAppraisal(id, tenantId);
  if (!a) throw new HttpError(404, "NOT_FOUND", "appraisal not found");
  return a;
}
