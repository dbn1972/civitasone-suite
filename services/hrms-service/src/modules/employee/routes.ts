import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RequestContext } from "@civitasone/types";
import { ZodError } from "zod";
import { listQuerySchema, acceptedResponseSchema } from "@civitasone/schemas/common";
import { employeesListSchema } from "@civitasone/schemas/web";
import {sendValidated, sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { PiiDecryptError } from "../../shared/pii-crypto.js";
import { createEmployeeBody, confirmEmployeeBody, idParam, updateEmployeeBody, employeeListQuery } from "./validators.js";
import { assertKnownEngagementType } from "./engagement-policy.js";
import { resolveEmployeeForActor, extractActorEmail } from "./actor-link.js";
import { transferBody, separateBody } from "../lifecycle/validators.js";
import { promotionBody } from "../lifecycle/validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";

const HR_ROLES    = ["hr_admin", "hr_officer", "super_admin"];
const READER_ROLES = [...HR_ROLES, "manager"];

/**
 * SEC finding (HRMS role review): READER_ROLES lets a bare "manager" read
 * ANY employee tenant-wide via both routes below — the underlying queries
 * took no actor/reporting-chain parameter at all. Editing was already
 * correctly restricted (PATCH excludes "manager"); this closes the matching
 * read-scope gap.
 *
 * A caller whose only READER_ROLES membership is "manager" (none of
 * HR_ROLES) may read only their own direct reports, via
 * hrmsEmployees.managerId — the same reporting-line FK orgchart's
 * tree-building and leave/routes.ts's manager-exemption check
 * ("isManagerOfTarget = ... emp.managerId === actorEmp.id") already use for
 * exactly this relationship. Direct reports only (not the full subtree),
 * matching that leave/routes.ts precedent rather than inventing a different
 * shape here.
 *
 * hrms_employees also has live `reporting_officer_id`/`hod_id` columns
 * (migrations/0007_geo_attendance_ro.sql) — checked and deliberately NOT
 * used: they are absent from schema.ts (never Drizzle-mapped) and are not
 * read or written by any application code; that migration's own comment
 * ("managerId already exists, we use it as reporting officer") documents
 * managerId as the intended field. managerId is the one every existing
 * "who reports to whom" consumer in this codebase actually uses.
 *
 * Returns:
 *  - undefined  caller holds an HR_ROLES role — unrestricted, tenant-wide
 *               read access, unchanged from before this fix (HR membership
 *               wins even if the caller ALSO holds "manager").
 *  - a string   caller is manager-only and linked to this hrms_employees
 *               row (see resolveEmployeeForActor) — restrict reads to
 *               direct reports of this id.
 *  - null       caller is manager-only but has NO resolvable employee link
 *               yet — fail CLOSED (no reporting relationship is provable),
 *               not fail-open "no scope = see everyone".
 */
async function resolveManagerScope(ctx: RequestContext, req: FastifyRequest): Promise<string | null | undefined> {
  const isHrActor = HR_ROLES.some((r) => ctx.roles.includes(r));
  if (isHrActor) return undefined;
  const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId, extractActorEmail(req));
  return actorEmp?.id ?? null;
}

export async function employeeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/employees", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const q = employeeListQuery.parse(req.query);
    const managerScope = await resolveManagerScope(ctx, req);
    sendValidated(reply, employeesListSchema, await queries.listEmployees(ctx.tenantId, q.limit, q.offset, q.employeeType, managerScope));
  });

  app.post("/v1/hrms/employees", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = createEmployeeBody.parse(req.body);
    await assertKnownEngagementType(ctx.tenantId, body.employeeType);
    return sendAccepted(reply, acceptedResponseSchema, await commands.createEmployee(ctx, body));
  });

  app.patch("/v1/hrms/employees/:id/confirm", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = confirmEmployeeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.confirmEmployee(ctx, id, body));
  });

  app.patch("/v1/hrms/employees/:id/transfer", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = transferBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.transferEmployee(ctx, id, body));
  });

  // eOffice loop — submit a transfer for administrative approval. Records a
  // transfer request in `pending_approval` and returns its id (used as the
  // eFile source_ref_id). The decision returns on hrms.transfer.file_decided.
  app.post("/v1/hrms/employees/:id/transfer/submit-approval", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = transferBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitTransferForApproval(ctx, id, body));
  });

  // eOffice loop — submit a promotion for administrative approval. Records a
  // promotion request in `pending_approval` and returns its id (used as the
  // eFile source_ref_id). The decision returns on hrms.promotion.file_decided.
  app.post("/v1/hrms/employees/:id/promotion/submit-approval", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = promotionBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.submitPromotionForApproval(ctx, id, body));
  });

  app.patch("/v1/hrms/employees/:id/separate", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = separateBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.separateEmployee(ctx, id, body));
  });

  app.get("/v1/hrms/employees/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, READER_ROLES);
    const { id } = idParam.parse(req.params);
    const managerScope = await resolveManagerScope(ctx, req);
    if (managerScope !== undefined) {
      // Manager-only caller: gate on the raw row BEFORE building the full
      // shaped detail. A genuinely nonexistent id (raw === null) falls
      // through unchanged to the getEmployeeDetail/404 path below, for every
      // role alike — this only ever turns an existing-but-not-mine record
      // into a 403, never a real 404 into something else.
      const raw = await queries.getEmployee(id, ctx.tenantId);
      const isDirectReport = raw != null && managerScope != null && raw.managerId === managerScope;
      if (raw && !isDirectReport) {
        // 403, not a disguised 404: matches leave/routes.ts's identical
        // "not self, not a direct report" ownership check
        // (HttpError(403, "FORBIDDEN", "...or, for managers, a direct
        // report's)")) for consistency, and the employee id-space is an
        // unguessable UUID, so 403 here doesn't meaningfully aid enumeration.
        throw new HttpError(403, "FORBIDDEN", "managers may only view their own direct reports' records");
      }
    }
    const detail = await queries.getEmployeeDetail(id, ctx.tenantId);
    if (!detail) throw new HttpError(404, "NOT_FOUND", "employee not found");
    return reply.send(detail);
  });

  app.patch("/v1/hrms/employees/:id", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const { id } = idParam.parse(req.params);
    const body = updateEmployeeBody.parse(req.body);
    return sendAccepted(reply, acceptedResponseSchema, await commands.updateEmployee(ctx, id, body));
  });

  app.setErrorHandler(errorHandler);
}

function errorHandler(err: unknown, req: any, reply: any): void {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
  if (err instanceof ZodError) {
    void reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    return;
  }
  if (err instanceof HttpError) {
    void reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    return;
  }
  if (err instanceof PiiDecryptError) {
    // M2: a tampered / undecryptable PII field fails closed as a typed 422,
    // not a raw retryable 500.
    req.log.error({ err }, "PII decrypt failed");
    void reply.code(422).send({ code: err.code, message: "stored PII could not be decrypted", correlationId, retryable: false });
    return;
  }
  req.log.error({ err }, "unhandled error");
  void reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
}
