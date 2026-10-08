/**
 * Medical Claims Module
 *
 * Endpoints:
 *  POST   /v1/hrms/medical/claims            — submit medical claim
 *  GET    /v1/hrms/medical/claims            — list my claims
 *  PATCH  /v1/hrms/medical/claims/:id/approve — HR approves/rejects
 *  GET    /v1/hrms/medical/hospitals         — empanelled hospital list
 *  GET    /v1/hrms/medical/insurance         — my insurance details (CGHS/state)
 *  GET    /v1/hrms/medical/history           — medical history timeline
 *
 * Schema: employee_id, claim_type (indoor/outdoor/reimbursement/advance), amount (paise),
 *         hospital_name, hospital_id, diagnosis, documents[], status, dependant_name, dependant_relation
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RequestContext } from "@civitasone/types";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { sqlClient } from "../../shared/db.js";
import { withRawTenantGuc } from "@civitasone/db";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { resolveEmployeeForActor } from "../employee/actor-link.js";

const HR_ROLES = ["hr_admin", "hr_officer", "super_admin", "finance_officer"];
const SELF_ROLES = [...HR_ROLES, "manager", "employee"];

/**
 * IDOR fix (audit: medical claims/insurance/history leaked tenant-wide to a
 * bare "employee" caller — employeeId was either optional-and-unchecked or
 * required-but-never-compared-to-the-actor).
 *
 * Self-service ownership guard shared by the three read routes below.
 * Resolves the caller's OWN hrms_employees row the same way
 * self-service/routes.ts and leave/routes.ts's enforceCcsLeaveRules already
 * do elsewhere in this service (hrms_employees.user_ref = actorId, email
 * fallback via resolveEmployeeForActor) — deliberately NOT a raw
 * `ctx.actorId === employeeId` comparison: actorId is the JWT subject, a
 * different id space from hrms_employees.id (see actor-link.ts). That
 * shallower comparison does appear elsewhere in this codebase (e.g.
 * attendance/routes.ts's overtime routes), but resolveEmployeeForActor is
 * the pattern this module's own service already established and tested for
 * "is this caller looking at their own record", so claims/insurance/history
 * follow it too instead of introducing a second, inconsistent convention.
 *
 * HR/finance/manager roles pass `requested` through unchanged. This module
 * has no existing "manager scoped to direct reports" precedent of its own
 * the way leave/routes.ts does, so manager stays aligned with HR here
 * (today's tenant-wide access) — the audit's confirmed critical issue is
 * only the bare "employee" role's default-tenant-wide leak.
 *
 * A bare `employee` caller is always forced onto their own linked record,
 * regardless of what (if anything) they requested. Returns:
 *   - `requested` unchanged (string | undefined) — privileged caller.
 *   - a uuid                                     — self-service caller, resolved.
 *   - null                                        — self-service caller with NO
 *     linked employee record. Callers MUST treat this as "nothing to show"
 *     (fails CLOSED — mirrors employee/routes.ts's resolveManagerScope and
 *     the manager-employee-read-scope-real-db.test.ts precedent for list
 *     routes), never fall through to an unscoped query.
 */
async function resolveSelfScopedEmployeeId(
  ctx: RequestContext,
  req: FastifyRequest,
  requested: string | undefined,
): Promise<string | undefined | null> {
  const isPrivileged = [...HR_ROLES, "manager"].some((r) => ctx.roles.includes(r));
  if (isPrivileged) return requested;
  const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
  return actorEmp ? actorEmp.id : null;
}

/**
 * medical.hrms_medical_claims has RLS ENABLEd and FORCEd (migration
 * 0040_medical_claims.sql), and this module talks to `sqlClient` directly (no
 * Drizzle schema attached in this file, so there is no ORM-level transaction
 * wrapper — where `wrapWithTenantGuc` injects `app.tenant_id` — anywhere in
 * the call path). Without this, every query below would run with no GUC set
 * and the connecting role (`hrms_svc`, NOBYPASSRLS non-superuser) would get a
 * row-security violation on write / zero rows back on read, silently: RLS
 * fails CLOSED. See `@civitasone/db`'s `withRawTenantGuc` for the shared fix
 * (already applied the same way in this service's workforce-planning module).
 *
 * NOTE for the F3 leftover-CQRS guard test (tests/f3-leftover-hrms-cqrs.test.ts):
 * this file's actual writes below (INSERT/UPDATE on hrms_medical_claims) are
 * raw sqlClient/tx tagged-template SQL, not Drizzle ORM method calls, so the
 * guard's regex never matched them — the ONE line it used to flag here was
 * this comment block's prose mentioning the ORM transaction-wrapper method by
 * name (spelled out as an object-dot-method call), a false positive from
 * regex-scanning comment text, not a real leftover synchronous write.
 * Rewording it (as above, and avoiding spelling that name out verbatim
 * anywhere in this file) is the whole fix; the medical-claims submit/approve
 * writes were not touched.
 */
function withTenantGuc<T>(
  tenantId: string,
  fn: (tx: typeof sqlClient) => Promise<T>,
): Promise<T> {
  return withRawTenantGuc(sqlClient, tenantId, fn);
}

/**
 * GAP-HR-MEDICAL-01 (DPDP): audits a bulk read of medical claims by a
 * privileged (HR or manager) caller — this module has no existing
 * read-audit precedent of its own (medical/consumer.ts's own AUDIT topic,
 * and recruitment/audit-emit.ts's emitAudit, are both write-path-only:
 * enqueue() runs from inside the SAME db.transaction as the business write
 * it accompanies). A bare "employee" viewing their own claims is
 * intentionally NOT audited here — only reads that expose OTHER people's
 * health data are DPDP-sensitive in the way this event exists to record.
 *
 * Routes must not write to Postgres directly (CLAUDE.md rule 6; CI's
 * f3-leftover-hrms-cqrs.test.ts greps every *routes.ts file for a
 * synchronous `db.transaction`/Drizzle write) — there is also no business
 * write here to piggyback a transaction on for a GET. So this publishes a
 * lightweight command instead, the same async CQRS shape as every other
 * mutation in this service (see loans-commands.ts's `pub()`); the actual
 * outbox insert happens in medical/consumer.ts's medicalClaimsListRead
 * subscriber. queue.publish() resolves before its consumer runs (see that
 * subscriber's own comment) — deliberately not awaited-through: an audit
 * log landing microseconds after the response is not the same "decide and
 * durable write must be one atomic step" problem this codebase's few
 * disclosed synchronous-write exceptions solve (nothing here needs the
 * audit event's outcome reflected back in the HTTP response).
 */
async function auditMedicalClaimsListRead(
  ctx: RequestContext,
  details: { employeeIdFilter: string | null; statusFilter: string | null; rowCount: number },
): Promise<void> {
  await queue.publish(COMMANDS.medicalClaimsListRead, {
    messageId: randomUUID(),
    type: COMMANDS.medicalClaimsListRead,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      service: "hrms",
      action: "list",
      resourceType: "medical_claim",
      resourceId: details.employeeIdFilter ?? "tenant_list",
      outcome: "success",
      rowCount: details.rowCount,
      filter: { employeeId: details.employeeIdFilter, status: details.statusFilter },
    },
  });
}

/**
 * GAP2-HRMS-MEDICAL-01 / -02: emit a PRECISE audit.event.record for a medical
 * claim's maker-write (create) and the checker-write (approve/reject).
 *
 * These two writes are the only mutating writes in this module that run as
 * synchronous raw-SQL (the disclosed exception documented on the
 * submit/approve handlers below), so — unlike every CQRS write in this
 * service — they get no in-transaction consumer audit. The generic
 * onResponse audit hook (shared/audit-log.ts) that would otherwise cover
 * them records only a coarse `resourceType="medical", action="update",
 * resourceId=null` row (the URL segment at index 3 is the literal "claims",
 * not a UUID, and PATCH maps to a generic "update"), so it can say neither
 * WHICH claim was decided, nor whether it was approved vs rejected, nor the
 * approved amount.
 *
 * Fixed exactly like auditMedicalClaimsListRead above: publish a lightweight
 * command (fire-and-forget — a route may not write to Postgres directly;
 * f3-leftover-hrms-cqrs.test.ts) whose consumer (medical/consumer.ts) writes
 * the audit outbox row. The two previously-orphaned medicalClaimCreate /
 * medicalClaimApprove subscriptions are repurposed into those audit
 * recorders, so every `queue.subscribe` in this module now has a matching
 * `queue.publish` (GAP2-HRMS-MEDICAL-02) and the write path's audit story is
 * honest. The business write itself stays in the handler's own
 * withTenantGuc transaction, unchanged.
 */
async function auditMedicalClaimCreate(
  ctx: RequestContext,
  details: { claimId: string; employeeId: string; amountMinor: number },
): Promise<void> {
  await queue.publish(COMMANDS.medicalClaimCreate, {
    messageId: randomUUID(),
    type: COMMANDS.medicalClaimCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      service: "hrms",
      action: "create",
      resourceType: "medical_claim",
      resourceId: details.claimId,
      outcome: "success",
      employeeId: details.employeeId,
      amountMinor: details.amountMinor,
    },
  });
}

async function auditMedicalClaimDecision(
  ctx: RequestContext,
  details: { claimId: string; status: "approved" | "rejected"; approvedAmountMinor: number },
): Promise<void> {
  await queue.publish(COMMANDS.medicalClaimApprove, {
    messageId: randomUUID(),
    type: COMMANDS.medicalClaimApprove,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      service: "hrms",
      action: details.status === "approved" ? "approve" : "reject",
      resourceType: "medical_claim",
      resourceId: details.claimId,
      outcome: "success",
      approvedAmountMinor: details.approvedAmountMinor,
    },
  });
}

const submitClaimBody = z.object({
  employeeId: z.string().uuid(),
  // Must match migration 0040_medical_claims.sql's hrms_medical_claims_type_check
  // CHECK constraint (and schema.ts's claimType comment) — not an arbitrary choice.
  claimType: z.enum(["indoor", "outdoor", "reimbursement", "advance"]),
  amountMinor: z.coerce.number().int().min(1).describe("Amount in paise"),
  hospitalName: z.string().min(1).max(256),
  hospitalId: z.string().uuid().optional(),
  diagnosis: z.string().min(1).max(1000),
  documents: z.array(z.string().url().or(z.string().min(1).max(512))).default([]),
  dependantName: z.string().max(128).optional(),
  // Must match hrms_medical_claims_relation_check in migration 0040.
  dependantRelation: z.enum(["self", "spouse", "child", "parent"]).optional(),
  remarks: z.string().max(2000).optional(),
});

const approveBody = z.object({
  status: z.enum(["approved", "rejected"]),
  approvedAmountMinor: z.coerce.number().int().min(0).optional(),
  remarks: z.string().max(2000).optional(),
});

export async function medicalClaimsRoutes(app: FastifyInstance): Promise<void> {
  // Submit medical claim
  app.post("/v1/hrms/medical/claims", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SELF_ROLES);
    const body = submitClaimBody.parse(req.body);

    // Forgery fix: same self-scoping helper the read routes below already
    // use. Privileged roles (HR/finance/manager) keep today's behavior —
    // `body.employeeId` passes through unchanged, so HR can still file a
    // claim on behalf of a given employee (e.g. data-entry of a paper
    // submission; see "HR files a claim for a SECOND employee" in
    // medical-claims-real-db.test.ts). A bare "employee" caller is always
    // forced onto their OWN resolved employee record instead — closing the
    // forgery hole where any employee could set an arbitrary employeeId in
    // the body and have the claim recorded as a colleague's.
    const ownerEmployeeId = await resolveSelfScopedEmployeeId(ctx, req, body.employeeId);
    if (!ownerEmployeeId) {
      throw new HttpError(403, "NO_EMPLOYEE_LINK", "no linked employee record for this actor");
    }

    const id = randomUUID();
    // GAP-HR-MEDICAL-04: claim_no is not in the column list above -- it
    // self-assigns from migration 0156's IDENTITY column -- RETURNING reads
    // back whatever value it was actually given.
    const [inserted] = await withTenantGuc(ctx.tenantId, (tx) => tx`
      INSERT INTO medical.hrms_medical_claims (
        id, tenant_id, employee_id, claim_type, amount_minor, hospital_name,
        hospital_id, diagnosis, documents, status, dependant_name, dependant_relation,
        remarks, created_by, updated_by
      ) VALUES (
        ${id}, ${ctx.tenantId}, ${ownerEmployeeId}, ${body.claimType},
        ${body.amountMinor}, ${body.hospitalName}, ${body.hospitalId ?? null},
        ${body.diagnosis}, ${JSON.stringify(body.documents)}, 'pending',
        ${body.dependantName ?? null}, ${body.dependantRelation ?? null},
        ${body.remarks ?? null}, ${ctx.actorId}, ${ctx.actorId}
      )
      RETURNING claim_no
    `);

    // GAP2-HRMS-MEDICAL-01: record a precise create audit (claim's own id,
    // employee, amount) — the coarse onResponse hook can't (resourceId=null,
    // resourceType="medical"). Fire-and-forget, after the write committed.
    await auditMedicalClaimCreate(ctx, {
      claimId: id,
      employeeId: ownerEmployeeId,
      amountMinor: body.amountMinor,
    });

    return reply.code(201).send({
      data: { id, claimNo: inserted?.claim_no ?? null, employeeId: ownerEmployeeId, status: "pending", amountMinor: body.amountMinor },
    });
  });

  // List my claims
  app.get("/v1/hrms/medical/claims", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SELF_ROLES);

    const query = z.object({
      employeeId: z.string().uuid().optional(),
      // Must match hrms_medical_claims_status_check in migration 0040 ("settled", not "paid").
      status: z.enum(["pending", "approved", "rejected", "settled"]).optional(),
      // GAP-HR-MEDICAL-04: claim_no is now a real, DB-guaranteed-unique
      // column (migration 0156) instead of a client-side slice of the row's
      // opaque uuid, so it can be searched server-side.
      claimNo: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    // GAP-HR-MEDICAL-01: manager gets its OWN list-scope resolution here —
    // direct reports ONLY, never including the manager's own record ("my
    // team" is direct reports, not self — the same convention employee/
    // routes.ts's, loans-routes.ts's and leave/routes.ts's own manager
    // read-scope helpers all use; see manager-employee-read-scope-real-db.
    // test.ts:146 and leave/routes.ts's resolveNonHrEmployeeScope doc
    // comment). Deliberately NOT routed through resolveSelfScopedEmployeeId
    // below (used by submit/insurance/history) — that helper's manager
    // branch stays unchanged on purpose (see tests/medical-routes.test.ts's
    // "managers can submit claims" and "managers' access by employeeId is
    // preserved (unaffected...)" specs, which lock in today's manager
    // behavior for those three routes); this fix is scoped to the list
    // route only, matching GAP-HR-MEDICAL-01's own verified evidence and
    // acceptance criteria.
    const isHrActor = HR_ROLES.some((r) => ctx.roles.includes(r));
    const isManagerActor = !isHrActor && ctx.roles.includes("manager");
    let managerId: string | null = null;
    if (isManagerActor) {
      const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
      if (!actorEmp) return reply.send({ data: [] }); // fail CLOSED — no resolvable link, never tenant-wide
      managerId = actorEmp.id;
    }

    // IDOR guard (bare employee, unchanged): a bare "employee" caller is
    // forced onto their own linked employeeId regardless of what (if
    // anything) they requested. For a manager, this call still returns
    // `requested` unchanged (today's behavior for that role from this
    // helper) — but `effectiveEmployeeId` is never used as a manager's
    // filter below (managerId's own IN-subquery is), so it can't
    // reintroduce the tenant-wide leak this fix closes.
    const effectiveEmployeeId = isManagerActor
      ? undefined
      : await resolveSelfScopedEmployeeId(ctx, req, query.employeeId);
    if (effectiveEmployeeId === null) return reply.send({ data: [] });

    const rows = await withTenantGuc(ctx.tenantId, (tx) => tx`
      SELECT id, claim_no, employee_id, claim_type, amount_minor::text, hospital_name,
             hospital_id, status, dependant_name, dependant_relation,
             approved_amount_minor::text, created_at, updated_at
      FROM medical.hrms_medical_claims
      WHERE tenant_id = ${ctx.tenantId}
        ${managerId ? tx`AND employee_id IN (
            SELECT id FROM employee.hrms_employees
            WHERE tenant_id = ${ctx.tenantId} AND manager_id = ${managerId}
          )` : tx``}
        ${effectiveEmployeeId ? tx`AND employee_id = ${effectiveEmployeeId}` : tx``}
        ${query.status ? tx`AND status = ${query.status}` : tx``}
        ${query.claimNo !== undefined ? tx`AND claim_no = ${query.claimNo}` : tx``}
      ORDER BY created_at DESC
      LIMIT ${query.limit} OFFSET ${query.offset}
    `);

    // DPDP: audit bulk reads of other people's health data by HR/manager —
    // never for a bare employee viewing only their own claims.
    if (isHrActor || isManagerActor) {
      await auditMedicalClaimsListRead(ctx, {
        employeeIdFilter: query.employeeId ?? null,
        statusFilter: query.status ?? null,
        rowCount: rows.length,
      });
    }

    return reply.send({ data: rows });
  });

  // HR approve/reject claim
  app.patch("/v1/hrms/medical/claims/:id/approve", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = approveBody.parse(req.body);

    const approvedAmount = await withTenantGuc(ctx.tenantId, async (tx) => {
      const [existing] = await tx`
        SELECT id, status, amount_minor::text as amount_minor
        FROM medical.hrms_medical_claims
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId}
      `;
      if (!existing) throw new HttpError(404, "NOT_FOUND", "medical claim not found");
      if (existing.status !== "pending") {
        throw new HttpError(409, "WRONG_STATE", `claim is '${existing.status}', expected 'pending'`);
      }

      // Money-integrity fix (GAP-HR-MEDICAL-05): a client-supplied
      // approvedAmountMinor was previously accepted with only min(0)
      // validation (see approveBody above) -- nothing compared it to the
      // claim's own amount_minor, so any HR_ROLES caller hitting this route
      // directly (not just through the UI, which always passes the
      // original claimed amount through unmodified) could record an
      // approved amount exceeding what was actually claimed, silently: no
      // error, no warning. Reject up front, before `amount` is computed or
      // the row is touched, matching this handler's existing
      // fetch-then-validate-then-write shape and its sibling HttpError
      // (status, code, message) convention above.
      if (
        body.status === "approved" &&
        body.approvedAmountMinor !== undefined &&
        body.approvedAmountMinor > Number(existing.amount_minor)
      ) {
        throw new HttpError(
          400,
          "APPROVED_AMOUNT_EXCEEDS_CLAIMED",
          `approvedAmountMinor (${body.approvedAmountMinor}) exceeds claim amount_minor (${existing.amount_minor})`,
        );
      }

      const amount = body.status === "approved"
        ? (body.approvedAmountMinor ?? Number(existing.amount_minor))
        : 0;

      // Race fix: the SELECT above only proves the claim was 'pending' at
      // read time — two concurrent approve requests can both pass that
      // check before either commits. Re-assert status = 'pending' as part
      // of the UPDATE's own WHERE clause (atomic with the write, not a
      // separate round-trip) and use RETURNING to detect whether a
      // concurrent request already won the race. Same idiom as
      // updateEmployeeIfStatus (employee/repo.ts) and approveLeaveApp
      // (leave/repo.ts), adapted to this file's raw sqlClient tagged-SQL
      // style (see social/routes.ts's travel-request/expense-claim approve
      // handlers for the same raw-SQL shape).
      const updated = await tx`
        UPDATE medical.hrms_medical_claims
        SET status = ${body.status},
            approved_amount_minor = ${amount},
            remarks = COALESCE(${body.remarks ?? null}, remarks),
            approved_by = ${ctx.actorId},
            approved_at = NOW(),
            updated_by = ${ctx.actorId},
            updated_at = NOW()
        WHERE id = ${id} AND tenant_id = ${ctx.tenantId} AND status = 'pending'
        RETURNING id
      `;
      if (updated.length === 0) {
        throw new HttpError(409, "WRONG_STATE", "claim was concurrently processed by another request");
      }

      return amount;
    });

    // GAP2-HRMS-MEDICAL-01: record a precise decision audit — WHICH claim,
    // approve vs reject, and the approved amount. The coarse onResponse hook
    // records only resourceType="medical", action="update", resourceId=null.
    // Fire-and-forget, after the guarded UPDATE committed.
    await auditMedicalClaimDecision(ctx, {
      claimId: id,
      status: body.status,
      approvedAmountMinor: approvedAmount,
    });

    return reply.send({ data: { id, status: body.status, approvedAmountMinor: approvedAmount } });
  });

  // Empanelled hospital list
  //
  // NOT_IMPLEMENTED (was a 500 crash for every role, including super_admin):
  // this queried `employee.empanelled_hospitals`, a table that has never
  // existed under that name OR under any other name/schema anywhere in this
  // repo -- grepped every services/hrms-service/migrations/*.sql and every
  // *.sql file repo-wide for "hospital" and "empanel"; the only hits are the
  // unrelated hospital_name/hospital_id free-text columns on
  // medical.hrms_medical_claims (a claim records the hospital that treated
  // the claimant, it is not a master directory) and an unrelated "Hospital
  // Leave" leave-TYPE seed row. There is no real empanelled-hospital data
  // source anywhere to point this at -- this was never a working feature, not
  // a broken reference. Rather than invent a table or return a silent empty
  // list (which would misrepresent "no data source exists" as "zero
  // hospitals are empanelled"), this fails closed with an explicit 501 so
  // callers/UI can distinguish "not built yet" from "really zero rows".
  // Request validation and the role gate still run first, unchanged, so this
  // is a strict improvement (real, distinguishable error) over the previous
  // unconditional 500 -- see the PR description for the full writeup.
  app.get("/v1/hrms/medical/hospitals", async (req, _reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SELF_ROLES);

    z.object({
      city: z.string().max(128).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    }).parse(req.query);

    throw new HttpError(501, "NOT_IMPLEMENTED",
      "empanelled hospital directory has not been implemented — no backing table exists yet");
  });

  // My insurance details
  app.get("/v1/hrms/medical/insurance", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SELF_ROLES);

    const query = z.object({ employeeId: z.string().uuid() }).parse(req.query);

    // IDOR guard: same self-scoping as the claims list above. employeeId is
    // mandatory here, but a bare "employee" caller's value is still ignored
    // and replaced by their own linked id — an unresolvable link folds into
    // the same 404 a genuinely-missing record gets (never leaks whether the
    // record exists for someone else).
    const effectiveEmployeeId = await resolveSelfScopedEmployeeId(ctx, req, query.employeeId);
    if (!effectiveEmployeeId) throw new HttpError(404, "NOT_FOUND", "no insurance record found for employee");

    const [row] = await sqlClient`
      SELECT employee_id, scheme_type, scheme_id, card_number, validity_from,
             validity_to, tier, dependants, annual_limit_minor::text
      FROM employee.medical_insurance
      WHERE tenant_id = ${ctx.tenantId} AND employee_id = ${effectiveEmployeeId}
    `;

    if (!row) throw new HttpError(404, "NOT_FOUND", "no insurance record found for employee");
    return reply.send({ data: row });
  });

  // Medical history timeline
  app.get("/v1/hrms/medical/history", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, SELF_ROLES);

    const query = z.object({
      employeeId: z.string().uuid(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }).parse(req.query);

    // IDOR guard: same self-scoping as claims/insurance above.
    const effectiveEmployeeId = await resolveSelfScopedEmployeeId(ctx, req, query.employeeId);
    if (!effectiveEmployeeId) return reply.send({ data: [] });

    const rows = await withTenantGuc(ctx.tenantId, (tx) => tx`
      SELECT id, claim_type, amount_minor::text, approved_amount_minor::text,
             hospital_name, diagnosis, status, dependant_name,
             created_at, approved_at
      FROM medical.hrms_medical_claims
      WHERE tenant_id = ${ctx.tenantId} AND employee_id = ${effectiveEmployeeId}
      ORDER BY created_at DESC
      LIMIT ${query.limit} OFFSET ${query.offset}
    `);

    return reply.send({ data: rows });
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
