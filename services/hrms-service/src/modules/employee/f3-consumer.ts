import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { pgSchema, uuid, varchar, integer, boolean } from "drizzle-orm/pg-core";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import { hrmsEmployees } from "./schema.js";
import { checkMandatoryConditions } from "./activation-domain.js";
import { wouldCreateCycle, type ManagerGraph } from "./manager-domain.js";
import { hrmsEmployeeNominees, hrmsEmployeeAddresses } from "./schema.js";
import { hrmsDepartments, hrmsDesignations } from "./schema.js";
const log = pino({ name: "hrms-f3-employee" });

/**
 * Write-side view of the per-tenant employee-type master. The canonical
 * definition is module-local (and unexported) in ./employee-types-routes.ts;
 * ./engagement-policy.ts already declares its own read-side view of the same
 * table the same way, so this follows the established in-module convention.
 * Only the columns this consumer writes are declared.
 */
const employeeSchema = pgSchema("employee");
const employeeTypeMaster = employeeSchema.table("hrms_employee_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  code: varchar("code", { length: 24 }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  description: varchar("description", { length: 500 }),
  eligibleForLeave: boolean("eligible_for_leave").notNull().default(true),
  eligibleForPayroll: boolean("eligible_for_payroll").notNull().default(true),
  eligibleForAppraisal: boolean("eligible_for_appraisal").notNull().default(true),
  defaultProbationMonths: integer("default_probation_months").notNull().default(0),
  maxContractMonths: integer("max_contract_months"),
  payMode: varchar("pay_mode", { length: 16 }).notNull().default("monthly"),
  category: varchar("category", { length: 24 }).notNull().default("other"),
  paymentRoute: varchar("payment_route", { length: 16 }).notNull().default("payroll"),
  taxSection: varchar("tax_section", { length: 8 }).notNull().default("192"),
  statutoryPf: boolean("statutory_pf").notNull().default(true),
  statutoryEsi: boolean("statutory_esi").notNull().default(true),
  statutoryNps: boolean("statutory_nps").notNull().default(true),
  eligibleForGratuity: boolean("eligible_for_gratuity").notNull().default(true),
  eligibleForBonus: boolean("eligible_for_bonus").notNull().default(false),
  leaveEncashment: boolean("leave_encashment").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdBy: uuid("created_by").notNull(),
  version: integer("version").notNull().default(1),
});

export function registerF3_employee_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "employee_agent1_gap_routes__0",
      "employee_agent1_gap_routes__1",
      "employee_agent1_gap_routes__2",
      "employee_agent1_gap_routes__3",
      "employee_employee_types_routes__0",
      "employee_employee_types_routes__1",
      "employee_masters_routes__0",
      "employee_masters_routes__1",
      "employee_masters_routes__2",
      "employee_masters_routes__3",
      "employee_masters_routes__4",
      "employee_masters_routes__5",
      "employee_nominee_address_routes__0",
      "employee_nominee_address_routes__1",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    // Every publishF3Write call in this module passes a FRESH randomUUID() as the
    // envelope id, so `id` above is a brand-new identifier, never the :id path
    // param. Cases that address an EXISTING row therefore have to key off
    // params.id — using `id` would silently match zero rows (see targetId below).
    const targetId = String(params.id ?? "");
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "employee_agent1_gap_routes__0": {
            const rows = await tx.select({ id: hrmsEmployees.id, version: hrmsEmployees.version })
                    .from(hrmsEmployees)
                    .where(and(eq(hrmsEmployees.id, targetId), eq(hrmsEmployees.tenantId, p.tenantId)))
                    .limit(1);
                  if (!rows[0]) throw new HttpError(404, "NOT_FOUND", "employee not found");
                  const updated = await tx.update(hrmsEmployees)
                    .set({ fitnessStatus: body.fitnessStatus, updatedBy: msg.actorId, updatedAt: new Date() })
                    .where(and(eq(hrmsEmployees.id, targetId), eq(hrmsEmployees.version, rows[0].version)));
                  return updated;
            break;
          }
          case "employee_agent1_gap_routes__1": {
            // F3 reconstruction: the code-gen that stubbed
            // POST /v1/hrms/employees/:id/activate down to publishF3Write(...)
            // dropped the block that fetched the employee into `emp`
            // (agent1-gap-routes.ts). `emp.version` survived in the optimistic-
            // concurrency predicate below but was never declared here, so every
            // activation threw a ReferenceError inside this consumer AFTER the
            // route had already answered 200 — the employee was reported
            // activated but stayed in their previous status. The route's
            // mandatory-condition gate (checkMandatoryConditions) and the
            // "already active" guard have both already run at the HTTP layer and
            // are not repeated here; only the version token is needed to write.
            const rows = await tx.select({ id: hrmsEmployees.id, version: hrmsEmployees.version })
                    .from(hrmsEmployees)
                    .where(and(eq(hrmsEmployees.id, targetId), eq(hrmsEmployees.tenantId, p.tenantId)))
                    .limit(1);
            const emp = rows[0];
            if (!emp) throw new HttpError(404, "NOT_FOUND", "employee not found");
            await tx.update(hrmsEmployees)
                    // migration 0025_employee_status_contract.sql retired "active" in
                    // favor of "confirmed" (dropped from hrms_employees_status_check);
                    // writing "active" here violates the CHECK constraint and rolls the
                    // whole transaction back silently. See lifecycle/consumer.ts's
                    // lifecycleReinstate fix (PR #893) for the identical bug.
                    .set({ status: "confirmed", updatedBy: msg.actorId, updatedAt: new Date() })
                    .where(and(eq(hrmsEmployees.id, targetId), eq(hrmsEmployees.version, emp.version)));
            break;
          }
          case "employee_agent1_gap_routes__2": {
            const rows = await tx.select({ id: hrmsEmployees.id, status: hrmsEmployees.status, version: hrmsEmployees.version })
                    .from(hrmsEmployees)
                    .where(and(eq(hrmsEmployees.id, targetId), eq(hrmsEmployees.tenantId, p.tenantId)))
                    .limit(1);
                  const emp = rows[0];
                  if (!emp) throw new HttpError(404, "NOT_FOUND", "employee not found");
                  if (emp.status !== "no_show") {
                    throw new HttpError(409, "WRONG_STATE", `employee status is '${emp.status}', not 'no_show'`);
                  }
                  await tx.update(hrmsEmployees)
                    .set({ status: body.revertToStatus, updatedBy: msg.actorId, updatedAt: new Date() })
                    .where(and(eq(hrmsEmployees.id, targetId), eq(hrmsEmployees.version, emp.version)));
                  return { id: targetId, status: body.revertToStatus };
            break;
          }
          case "employee_agent1_gap_routes__3": {
            // Fetch current employee
                  const rows = await tx.select({
                    id: hrmsEmployees.id,
                    version: hrmsEmployees.version,
                    managerId: hrmsEmployees.managerId,
                    tenantId: hrmsEmployees.tenantId,
                  }).from(hrmsEmployees)
                    .where(and(eq(hrmsEmployees.id, targetId), eq(hrmsEmployees.tenantId, p.tenantId)))
                    .limit(1);
                  const emp = rows[0];
                  if (!emp) throw new HttpError(404, "NOT_FOUND", "employee not found");

                  // Build a lightweight manager graph for cycle detection
                  // Fetch all employees' manager edges in this tenant
                  const allEdges = await tx.select({
                    eid: hrmsEmployees.id,
                    mgr: hrmsEmployees.managerId,
                  }).from(hrmsEmployees)
                    .where(eq(hrmsEmployees.tenantId, p.tenantId));

                  const graph: ManagerGraph = {
                    edges: new Map(allEdges.map((e) => [e.eid, e.mgr])),
                  };

                  // Validate each proposed manager for cycles
                  const updates: Record<string, unknown> = { updatedBy: msg.actorId, updatedAt: new Date() };

                  if (body.managerId !== undefined) {
                    if (body.managerId && wouldCreateCycle(graph, targetId, body.managerId)) {
                      throw new HttpError(422, "CYCLE_DETECTED", `assigning manager '${body.managerId}' would create a circular reporting chain`);
                    }
                    updates.managerId = body.managerId ?? null;
                  }
                  if (body.functionalManagerId !== undefined) {
                    if (body.functionalManagerId && wouldCreateCycle(graph, targetId, body.functionalManagerId)) {
                      throw new HttpError(422, "CYCLE_DETECTED", `assigning functional manager '${body.functionalManagerId}' would create a circular reporting chain`);
                    }
                    updates.functionalManagerId = body.functionalManagerId ?? null;
                  }
                  if (body.projectManagerId !== undefined) {
                    if (body.projectManagerId && wouldCreateCycle(graph, targetId, body.projectManagerId)) {
                      throw new HttpError(422, "CYCLE_DETECTED", `assigning project manager '${body.projectManagerId}' would create a circular reporting chain`);
                    }
                    updates.projectManagerId = body.projectManagerId ?? null;
                  }

                  await tx.update(hrmsEmployees).set(updates)
                    .where(and(eq(hrmsEmployees.id, targetId), eq(hrmsEmployees.version, emp.version)));

                  return { id: targetId, ...body };
            break;
          }
          case "employee_employee_types_routes__0": {
            // F3 reconstruction: `employeeTypeMaster` was never imported (the
            // table is declared module-locally in employee-types-routes.ts), so
            // this case threw a ReferenceError on every employee-type creation
            // while the route had already answered 201. A write-side view of the
            // table is now declared at the top of this file.
            //
            // The generated code spread `...body` straight into values(). That is
            // both unsafe (a caller-supplied body.tenantId/body.id would have
            // overridden the trusted envelope values — the spread came AFTER
            // them) and lossy, because `body` here is the RAW request body, not
            // the Zod-parsed one, so createBody's .default(...) values are not
            // applied. Columns are enumerated explicitly below with those Zod
            // defaults spelled out field-for-field.
            await tx.insert(employeeTypeMaster).values({
                  id, tenantId: p.tenantId,
                  code: body.code, name: body.name,
                  description: body.description ?? null,
                  eligibleForLeave: body.eligibleForLeave ?? true,
                  eligibleForPayroll: body.eligibleForPayroll ?? true,
                  eligibleForAppraisal: body.eligibleForAppraisal ?? true,
                  defaultProbationMonths: body.defaultProbationMonths ?? 0,
                  maxContractMonths: body.maxContractMonths ?? null,
                  payMode: body.payMode ?? "monthly",
                  category: body.category ?? "other",
                  paymentRoute: body.paymentRoute ?? "payroll",
                  taxSection: body.taxSection ?? "192",
                  statutoryPf: body.statutoryPf ?? true,
                  statutoryEsi: body.statutoryEsi ?? true,
                  statutoryNps: body.statutoryNps ?? true,
                  eligibleForGratuity: body.eligibleForGratuity ?? true,
                  eligibleForBonus: body.eligibleForBonus ?? false,
                  leaveEncashment: body.leaveEncashment ?? true,
                  sortOrder: body.sortOrder ?? 0,
                  createdBy: msg.actorId,
                }).onConflictDoNothing();
            break;
          }
          case "employee_employee_types_routes__1": {
            // F3 reconstruction: both `employeeTypeMaster` (never imported) and
            // `patch` (built field-by-field in the route before it was stubbed
            // out) were undefined here, so every employee-type PATCH threw while
            // the route reported 200 "updated". The sparse patch below mirrors
            // employee-types-routes.ts exactly: only keys actually present in the
            // request body are written, so an omitted field is left untouched
            // rather than being reset to a default.
            const patch: Record<string, unknown> = {};
            if (body.code !== undefined) patch.code = body.code;
            if (body.name !== undefined) patch.name = body.name;
            if (body.description !== undefined) patch.description = body.description ?? null;
            if (body.eligibleForLeave !== undefined) patch.eligibleForLeave = body.eligibleForLeave;
            if (body.eligibleForPayroll !== undefined) patch.eligibleForPayroll = body.eligibleForPayroll;
            if (body.eligibleForAppraisal !== undefined) patch.eligibleForAppraisal = body.eligibleForAppraisal;
            if (body.defaultProbationMonths !== undefined) patch.defaultProbationMonths = body.defaultProbationMonths;
            if (body.maxContractMonths !== undefined) patch.maxContractMonths = body.maxContractMonths;
            if (body.payMode !== undefined) patch.payMode = body.payMode;
            if (body.category !== undefined) patch.category = body.category;
            if (body.paymentRoute !== undefined) patch.paymentRoute = body.paymentRoute;
            if (body.taxSection !== undefined) patch.taxSection = body.taxSection;
            if (body.statutoryPf !== undefined) patch.statutoryPf = body.statutoryPf;
            if (body.statutoryEsi !== undefined) patch.statutoryEsi = body.statutoryEsi;
            if (body.statutoryNps !== undefined) patch.statutoryNps = body.statutoryNps;
            if (body.eligibleForGratuity !== undefined) patch.eligibleForGratuity = body.eligibleForGratuity;
            if (body.eligibleForBonus !== undefined) patch.eligibleForBonus = body.eligibleForBonus;
            if (body.leaveEncashment !== undefined) patch.leaveEncashment = body.leaveEncashment;
            if (body.sortOrder !== undefined) patch.sortOrder = body.sortOrder;
            if (Object.keys(patch).length === 0) break;
            // Tenant predicate added deliberately: the row is addressed by a
            // caller-supplied path param, so scoping the UPDATE to the envelope's
            // tenant keeps one tenant from mutating another's type master.
            await tx.update(employeeTypeMaster).set(patch as any)
              .where(and(eq(employeeTypeMaster.id, targetId), eq(employeeTypeMaster.tenantId, p.tenantId)));
            break;
          }
          case "employee_masters_routes__0": {
            // F3 leftover fix (batch 2): masters-routes.ts now publishes this
            // op (department create) instead of writing inline. This case was
            // dead code before — the id below is the route-generated uuid
            // (routes.ts now passes it explicitly so it can reply with it).
            await tx.insert(hrmsDepartments).values({
                  id, tenantId: p.tenantId, code: body.code, name: body.name,
                  parentId: body.parentId ?? null,
                  ...(body.type ? { type: body.type } : {}),
                  ...(body.level !== undefined ? { level: body.level } : {}),
                  ...(body.govtTier ? { govtTier: body.govtTier } : {}),
                  ...(body.locationId ? { locationId: body.locationId } : {}),
                  ...(body.headEmployeeId ? { headEmployeeId: body.headEmployeeId } : {}),
                  createdBy: msg.actorId, updatedBy: msg.actorId,
                });
            break;
          }
          case "employee_masters_routes__1": {
            // F3 leftover fix (batch 2): masters-routes.ts now publishes this
            // op (designation create) instead of writing inline — same
            // reasoning as __0.
            await tx.insert(hrmsDesignations).values({
                  id, tenantId: p.tenantId, code: body.code, name: body.name,
                  level: body.level ?? 0, payGrade: body.payGrade ?? null,
                  createdBy: msg.actorId, updatedBy: msg.actorId,
                });
            break;
          }
          case "employee_masters_routes__2": {
            // Restored: department PATCH. routes.ts already 404s synchronously
            // if `targetId` doesn't exist (see masters-routes.ts), so this is
            // the guarded update that used to run inline in the route.
            const deptPatch: Record<string, unknown> = {};
            if (body.code !== undefined) deptPatch.code = body.code;
            if (body.name !== undefined) deptPatch.name = body.name;
            if (body.parentId !== undefined) deptPatch.parentId = body.parentId;
            if (body.type !== undefined) deptPatch.type = body.type;
            if (body.level !== undefined) deptPatch.level = body.level;
            if (body.govtTier !== undefined) deptPatch.govtTier = body.govtTier;
            if (body.locationId !== undefined) deptPatch.locationId = body.locationId;
            if (body.headEmployeeId !== undefined) deptPatch.headEmployeeId = body.headEmployeeId;
            await tx.update(hrmsDepartments)
                  .set({ ...deptPatch, updatedBy: msg.actorId } as never)
                  .where(eq(hrmsDepartments.id, targetId));
            break;
          }
          case "employee_masters_routes__3": {
            // Restored: department DELETE. Existence already checked
            // synchronously by the route.
            await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.id, targetId));
            break;
          }
          case "employee_masters_routes__4": {
            // Restored: designation PATCH — same reasoning as __2.
            const desigPatch: Record<string, unknown> = {};
            if (body.code !== undefined) desigPatch.code = body.code;
            if (body.name !== undefined) desigPatch.name = body.name;
            if (body.level !== undefined) desigPatch.level = body.level;
            if (body.payGrade !== undefined) desigPatch.payGrade = body.payGrade;
            await tx.update(hrmsDesignations)
                  .set({ ...desigPatch, updatedBy: msg.actorId } as never)
                  .where(eq(hrmsDesignations.id, targetId));
            break;
          }
          case "employee_masters_routes__5": {
            // Restored: designation DELETE — same reasoning as __3.
            await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.id, targetId));
            break;
          }
          case "employee_nominee_address_routes__0": {
            // F3 reconstruction: `nid` (the nominee row's own id, generated in
            // nominee-address-routes.ts before the route was stubbed out) was
            // undefined, so every nominee POST threw here after the route had
            // answered 201. The envelope id `id` is used as the row key, matching
            // how the other insert cases in this file are keyed. `employeeId`
            // must come from the :id path param — the generated code passed the
            // envelope id, which is an unrelated fresh UUID and would have
            // violated the employee foreign key.
            await tx.insert(hrmsEmployeeNominees).values({
                  id, tenantId: p.tenantId, employeeId: targetId,
                  name: body.name, relationship: body.relationship, purpose: body.purpose,
                  dateOfBirth: body.dateOfBirth ?? null, sharePercent: body.sharePercent ?? null,
                  contactPhone: body.contactPhone ?? null,
                  createdBy: msg.actorId, updatedBy: msg.actorId,
                });
            break;
          }
          case "employee_nominee_address_routes__1": {
            // Same reconstruction as __0, for the address POST: `aid` was
            // undefined and `employeeId` was taking the envelope id instead of
            // the :id path param.
            await tx.insert(hrmsEmployeeAddresses).values({
                  id, tenantId: p.tenantId, employeeId: targetId,
                  addressType: body.addressType, line1: body.line1, line2: body.line2 ?? null,
                  city: body.city ?? null, state: body.state ?? null, pincode: body.pincode ?? null,
                  country: body.country, isCurrent: body.isCurrent, effectiveFrom: body.effectiveFrom ?? null,
                  createdBy: msg.actorId,
                });
            break;
          }
        }
      });
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      throw err;
    }
  });
}
