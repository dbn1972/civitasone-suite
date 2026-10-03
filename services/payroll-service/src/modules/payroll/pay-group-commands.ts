/**
 * GAP-PAYROLL-PAY-GROUPS-03: command publishers for pay-group membership and
 * the synchronous creation of pay-group-scoped payroll runs.
 *
 * Membership routes publish a command (randomUUID messageId) and return 202;
 * pay-group-consumer.ts does the write (transaction + audit outbox event).
 * Run creation follows the existing createRun shape (commands.ts): the run
 * ROWS are inserted synchronously under the period advisory lock so a
 * concurrent duplicate gets a real 409, and the per-employee processing is
 * published to the runCreate consumer.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { db, scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { audit } from "./consumer.js";
import type { CreateRunBody } from "./validators.js";
import { findDoubleRunEmployees, resolveMonthMembers } from "./pay-group-repo.js";

export type Accepted = { id: string; status: string; correlationId: string };

function envelope(ctx: RequestContext, type: string, payload: Record<string, unknown>, messageId: string = randomUUID()) {
  return {
    messageId, type,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, ...payload },
  };
}

export async function assignPayGroupMember(
  ctx: RequestContext, p: { payGroupId: string; employeeId: string; effectiveFrom: string; reason: string },
): Promise<Accepted> {
  await queue.publish(COMMANDS.payGroupMemberAssign, envelope(ctx, COMMANDS.payGroupMemberAssign, p));
  return { id: p.payGroupId, status: "accepted", correlationId: ctx.correlationId };
}

export async function endPayGroupMember(
  ctx: RequestContext, p: { payGroupId: string; employeeId: string; endsOn: string; reason: string },
): Promise<Accepted> {
  await queue.publish(COMMANDS.payGroupMemberEnd, envelope(ctx, COMMANDS.payGroupMemberEnd, p));
  return { id: p.payGroupId, status: "accepted", correlationId: ctx.correlationId };
}

/** One command, one transaction and ONE audit event for the whole batch. */
export async function bulkAssignPayGroupMembers(
  ctx: RequestContext, p: { payGroupId: string; employeeIds: string[]; effectiveFrom: string; reason: string },
): Promise<Accepted & { batchId: string }> {
  const batchId = randomUUID();
  await queue.publish(COMMANDS.payGroupMemberBulkAssign, envelope(ctx, COMMANDS.payGroupMemberBulkAssign, { batchId, ...p }));
  return { id: batchId, batchId, status: "accepted", correlationId: ctx.correlationId };
}

export async function setPayGroupSettings(
  ctx: RequestContext, p: { allowMidMonthEffective: boolean; reason: string },
): Promise<Accepted> {
  await queue.publish(COMMANDS.payGroupSettingsSet, envelope(ctx, COMMANDS.payGroupSettingsSet, p));
  return { id: ctx.tenantId, status: "accepted", correlationId: ctx.correlationId };
}

// ─── pay-group-scoped payroll runs ──────────────────────────────────────────


export function isPayGroupRun(body: Pick<CreateRunBody, "payGroupId" | "payGroupIds" | "allPayGroupsOfDdo">): boolean {
  return body.payGroupId !== undefined || (body.payGroupIds?.length ?? 0) > 0 || body.allPayGroupsOfDdo === true;
}

type GroupRow = { id: string; name: string; status: string; ddo_code: string | null; bill_type: string };

function runNoFor(base: string, group: GroupRow, multiple: boolean): string {
  if (!multiple) return base;
  const slug = group.name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || group.id.slice(0, 8);
  return `${base}-${slug}`.slice(0, 64);
}

/**
 * Create one regular run per selected pay group (a pay group is a bill, so a
 * DDO's gazetted and non-gazetted bills are separate runs). Each run pays
 * exactly the employees whose assignment covers the run month. Refuses, with
 * 409 EMPLOYEE_ALREADY_IN_RUN, a group with a member that is already in
 * another non-cancelled regular run for the month; the claims table
 * (migration 0084) is the race-safe backstop when the runs are processed.
 */
export async function createPayGroupRuns(
  ctx: RequestContext, body: CreateRunBody,
): Promise<Accepted & { runIds: string[]; skippedEmptyGroups: string[] }> {
  const runType = body.runType ?? "regular";
  if (runType !== "regular") {
    throw new HttpError(400, "PAY_GROUP_RUN_REGULAR_ONLY", "pay-group runs are regular runs; omit the pay group for supplementary / arrears / pensioner runs");
  }
  const explicit = [...new Set([...(body.payGroupId ? [body.payGroupId] : []), ...(body.payGroupIds ?? [])])];

  const groups = await scopedRead(async (tx) => {
    if (explicit.length > 0) {
      const found = (await tx.execute(sql`
        SELECT id, name, status, ddo_code, bill_type FROM payroll.pay_groups
         WHERE tenant_id = ${ctx.tenantId}::uuid AND id IN (${sql.join(explicit.map((g) => sql`${g}::uuid`), sql`, `)})
         ORDER BY name
      `)) as unknown as GroupRow[];
      if (found.length !== explicit.length) throw new HttpError(404, "PAY_GROUP_NOT_FOUND", "a selected pay group does not exist for this tenant");
      const inactive = found.find((g) => g.status !== "active");
      if (inactive) throw new HttpError(409, "PAY_GROUP_INACTIVE", `pay group ${inactive.name} is deactivated; reactivate it before starting a run`);
      return found;
    }
    const ddoCode = body.ddoCode!;
    const ddo = (await tx.execute(sql`
      SELECT is_active FROM payroll.payroll_ddos WHERE tenant_id = ${ctx.tenantId}::uuid AND ddo_code = ${ddoCode} LIMIT 1
    `)) as unknown as Array<{ is_active: boolean }>;
    if (!ddo[0]) throw new HttpError(404, "DDO_NOT_FOUND", `DDO ${ddoCode} is not registered for this tenant`);
    if (ddo[0].is_active === false) throw new HttpError(409, "DDO_INACTIVE", `DDO ${ddoCode} is deactivated; reactivate it before starting a run`);
    const found = (await tx.execute(sql`
      SELECT id, name, status, ddo_code, bill_type FROM payroll.pay_groups
       WHERE tenant_id = ${ctx.tenantId}::uuid AND ddo_code = ${ddoCode} AND status = 'active' ORDER BY name
    `)) as unknown as GroupRow[];
    if (found.length === 0) throw new HttpError(422, "NO_ACTIVE_PAY_GROUPS", `DDO ${ddoCode} has no active pay groups`);
    return found;
  });

  // Resolve each group's members for the month and pre-check double inclusion.
  const plan = await scopedRead(async (tx) => {
    const out: Array<{ group: GroupRow; employeeIds: string[] }> = [];
    for (const g of groups) {
      const members = [...(await resolveMonthMembers(tx, ctx.tenantId, body.month, g.id)).keys()];
      out.push({ group: g, employeeIds: members });
    }
    return out;
  });
  const skippedEmptyGroups: string[] = [];
  const runnable: typeof plan = [];
  for (const entry of plan) {
    if (entry.employeeIds.length === 0) {
      if (explicit.length > 0) {
        throw new HttpError(422, "PAY_GROUP_EMPTY", `pay group ${entry.group.name} has no members for ${body.month}`);
      }
      skippedEmptyGroups.push(entry.group.id);
      continue;
    }
    runnable.push(entry);
  }
  if (runnable.length === 0) {
    throw new HttpError(422, "PAY_GROUP_EMPTY", `none of the DDO's pay groups has members for ${body.month}`);
  }
  await scopedRead(async (tx) => {
    for (const { group, employeeIds } of runnable) {
      const already = await findDoubleRunEmployees(tx, ctx.tenantId, body.month, employeeIds, null);
      if (already.length > 0) {
        throw new HttpError(409, "EMPLOYEE_ALREADY_IN_RUN",
          `${already.length} member(s) of pay group ${group.name} are already in another regular payroll run for ${body.month}`);
      }
    }
  });

  const runs = runnable.map((e) => ({ id: randomUUID(), ...e }));
  await db.transaction(async (tx) => {
    // One lock for every pay-group run of the tenant+month, then the legacy
    // per-DDO key so a concurrent legacy run for the same DDO serialises too.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`payroll_run_groups:${ctx.tenantId}:${body.month}`}, 0))`);
    for (const r of runs) {
      // The group must still be active when its run row is written. FOR SHARE
      // serialises with deactivation (FOR UPDATE on the same row, see
      // fin03-consumer payGroupSetActive), so a group cannot be deactivated
      // between the checks above and this insert.
      const live = (await tx.execute(sql`
        SELECT status FROM payroll.pay_groups WHERE id = ${r.group.id}::uuid AND tenant_id = ${ctx.tenantId}::uuid FOR SHARE
      `)) as unknown as Array<{ status: string }>;
      if (live[0]?.status !== "active") {
        throw new HttpError(409, "PAY_GROUP_INACTIVE", `pay group ${r.group.name} is deactivated; reactivate it before starting a run`);
      }
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`payroll_run:${ctx.tenantId}:${body.month}:${r.group.ddo_code ?? "__ALL__"}:regular`}, 0))`);
      const dup = (await tx.execute(sql`
        SELECT id FROM payroll.payroll_runs
         WHERE tenant_id = ${ctx.tenantId}::uuid AND month = ${body.month} AND run_type = 'regular'
           AND status NOT IN ('failed', 'cancelled') AND pay_group_id = ${r.group.id}::uuid
         LIMIT 1
      `)) as unknown as Array<{ id: string }>;
      if (dup[0]) {
        throw new HttpError(409, "DUPLICATE_RUN_FOR_PERIOD", `a regular payroll run already exists for ${body.month} (pay group ${r.group.name}): ${dup[0].id}`);
      }
      const runNo = runNoFor(body.runNo, r.group, runs.length > 1);
      const noClash = (await tx.execute(sql`
        SELECT 1 FROM payroll.payroll_runs WHERE tenant_id = ${ctx.tenantId}::uuid AND run_no = ${runNo} LIMIT 1
      `)) as unknown as unknown[];
      if (noClash.length > 0) throw new HttpError(409, "DUPLICATE_RUN_NO", `run number ${runNo} is already used`);
      await repo.insertRun(tx, {
        id: r.id, tenantId: ctx.tenantId, runNo, month: body.month,
        departmentId: null, structureId: body.structureId!, runType: "regular",
        ddoCode: r.group.ddo_code, payGroupId: r.group.id,
        totalGrossMinor: 0n, totalNetMinor: 0n, currency: "INR", status: "processing",
        createdBy: ctx.actorId, updatedBy: ctx.actorId,
      });
      await audit(tx, { tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId }, "create", "payroll_run", r.id, {
        payGroupId: r.group.id, payGroupName: r.group.name, ddoCode: r.group.ddo_code, month: body.month, memberCount: r.employeeIds.length,
      });
    }
  });

  for (const r of runs) {
    const runNo = runNoFor(body.runNo, r.group, runs.length > 1);
    await queue.publish(COMMANDS.runCreate, {
      messageId: r.id, type: COMMANDS.runCreate,
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: {
        id: r.id, tenantId: ctx.tenantId, runNo, month: body.month, structureId: body.structureId,
        runType: "regular", ddoCode: r.group.ddo_code ?? undefined, payGroupId: r.group.id, status: "draft",
      },
    });
    await cache.put(cache.makeKey(ctx.tenantId, "payroll_run", r.id), { id: r.id, runNo, month: body.month, payGroupId: r.group.id, status: "draft" });
  }
  return { id: runs[0]!.id, status: "accepted", correlationId: ctx.correlationId, runIds: runs.map((r) => r.id), skippedEmptyGroups };
}
