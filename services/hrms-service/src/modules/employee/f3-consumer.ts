// @ts-nocheck — generated F3 leftover consumer; locals closed over from route txs
import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsEmployees } from "./schema.js";
import { checkMandatoryConditions } from "./activation-domain.js";
import { wouldCreateCycle, type ManagerGraph } from "./manager-domain.js";
import { hrmsEmployeeNominees, hrmsEmployeeAddresses } from "./schema.js";
import { hrmsDepartments, hrmsDesignations } from "./schema.js";
const log = pino({ name: "hrms-f3-employee" });
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
      "employee_nominee_address_routes__0",
      "employee_nominee_address_routes__1",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "employee_agent1_gap_routes__0": {
            const rows = await tx.select({ id: hrmsEmployees.id, version: hrmsEmployees.version })
                    .from(hrmsEmployees)
                    .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, p.tenantId)))
                    .limit(1);
                  if (!rows[0]) throw new HttpError(404, "NOT_FOUND", "employee not found");
                  const updated = await tx.update(hrmsEmployees)
                    .set({ fitnessStatus: body.fitnessStatus, updatedBy: msg.actorId, updatedAt: new Date() })
                    .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.version, rows[0].version)));
                  return updated;
            break;
          }
          case "employee_agent1_gap_routes__1": {
            await tx.update(hrmsEmployees)
                    .set({ status: "active", updatedBy: msg.actorId, updatedAt: new Date() })
                    .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.version, emp.version)));
            break;
          }
          case "employee_agent1_gap_routes__2": {
            const rows = await tx.select({ id: hrmsEmployees.id, status: hrmsEmployees.status, version: hrmsEmployees.version })
                    .from(hrmsEmployees)
                    .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, p.tenantId)))
                    .limit(1);
                  const emp = rows[0];
                  if (!emp) throw new HttpError(404, "NOT_FOUND", "employee not found");
                  if (emp.status !== "no_show") {
                    throw new HttpError(409, "WRONG_STATE", `employee status is '${emp.status}', not 'no_show'`);
                  }
                  await tx.update(hrmsEmployees)
                    .set({ status: body.revertToStatus, updatedBy: msg.actorId, updatedAt: new Date() })
                    .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.version, emp.version)));
                  return { id, status: body.revertToStatus };
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
                    .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, p.tenantId)))
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
                    if (body.managerId && wouldCreateCycle(graph, id, body.managerId)) {
                      throw new HttpError(422, "CYCLE_DETECTED", `assigning manager '${body.managerId}' would create a circular reporting chain`);
                    }
                    updates.managerId = body.managerId ?? null;
                  }
                  if (body.functionalManagerId !== undefined) {
                    if (body.functionalManagerId && wouldCreateCycle(graph, id, body.functionalManagerId)) {
                      throw new HttpError(422, "CYCLE_DETECTED", `assigning functional manager '${body.functionalManagerId}' would create a circular reporting chain`);
                    }
                    updates.functionalManagerId = body.functionalManagerId ?? null;
                  }
                  if (body.projectManagerId !== undefined) {
                    if (body.projectManagerId && wouldCreateCycle(graph, id, body.projectManagerId)) {
                      throw new HttpError(422, "CYCLE_DETECTED", `assigning project manager '${body.projectManagerId}' would create a circular reporting chain`);
                    }
                    updates.projectManagerId = body.projectManagerId ?? null;
                  }

                  await tx.update(hrmsEmployees).set(updates)
                    .where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.version, emp.version)));

                  return { id, ...body };
            break;
          }
          case "employee_employee_types_routes__0": {
            await tx.insert(employeeTypeMaster).values({
                  id, tenantId: p.tenantId, ...body,
                  description: body.description ?? null,
                  maxContractMonths: body.maxContractMonths ?? null,
                  createdBy: msg.actorId,
                }).onConflictDoNothing();
            break;
          }
          case "employee_employee_types_routes__1": {
            await tx.update(employeeTypeMaster).set(patch as any).where(eq(employeeTypeMaster.id, id));
            break;
          }
          case "employee_masters_routes__0": {
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
            await tx.insert(hrmsDesignations).values({
                  id, tenantId: p.tenantId, code: body.code, name: body.name,
                  level: body.level ?? 0, payGrade: body.payGrade ?? null,
                  createdBy: msg.actorId, updatedBy: msg.actorId,
                });
            break;
          }
          case "employee_nominee_address_routes__0": {
            await tx.insert(hrmsEmployeeNominees).values({
                  id: nid, tenantId: p.tenantId, employeeId: id,
                  name: body.name, relationship: body.relationship, purpose: body.purpose,
                  dateOfBirth: body.dateOfBirth ?? null, sharePercent: body.sharePercent ?? null,
                  contactPhone: body.contactPhone ?? null,
                  createdBy: msg.actorId, updatedBy: msg.actorId,
                });
            break;
          }
          case "employee_nominee_address_routes__1": {
            await tx.insert(hrmsEmployeeAddresses).values({
                  id: aid, tenantId: p.tenantId, employeeId: id,
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
