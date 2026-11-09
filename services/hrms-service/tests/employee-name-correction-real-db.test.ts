/**
 * UAT b23 (real Postgres, NOBYPASSRLS hrms_svc): HR name correction through
 * PATCH /v1/hrms/employees/:id { fullName, reason }.
 *
 *  - needs a reason (>= 10 chars), a non-blank trimmed name; HR roles only
 *  - blocked for exited employees (409 EMPLOYEE_EXITED at the route, and the
 *    consumer refuses a stale command that slipped past it)
 *  - audited: one `correct_name` audit.event.record with old -> new, reason, actor
 *  - live copies follow (non-revoked ID cards, today-and-later due-list rows);
 *    historical copies keep the old name (revoked card, earlier due-list run,
 *    seniority-list snapshot entry)
 *
 * Real async command -> consumer path (registerEmployeeConsumers + drain), same
 * convention as tests/employee-manager-guard-real-db.test.ts. Every direct
 * read/write goes through runWithTenant (FORCE RLS).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { buildApp } from "../src/app.js";
import { registerEmployeeConsumers } from "../src/modules/employee/consumer.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";
import { COMMANDS } from "../src/topics.js";
import type { FastifyInstance } from "fastify";
import type { MemoryQueue } from "@civitasone/queue";

registerEmployeeConsumers(queue);
const drain = (): Promise<void> => (queue as unknown as MemoryQueue).drain();

const TENANT = randomUUID();
const ACTOR = randomUUID();
// vitest.config.ts injects JWT_SECRET for every suite -- never a literal here (gitleaks scans every commit).
const SECRET = process.env.JWT_SECRET as string;
const deptId = randomUUID();
const desigId = randomUUID();
const auth = (roles = ["hr_officer"]) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
  "content-type": "application/json",
});

let app: FastifyInstance;

async function seedEmployee(status = "confirmed", fullName = "Sunita Devi"): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsEmployees).values({
      id, tenantId: TENANT, employeeNo: `NC-${id.slice(0, 8)}`, fullName,
      departmentId: deptId, designationId: desigId, dateOfJoining: "2015-01-01",
      status, employeeType: "permanent", createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
  return id;
}

const nameOf = async (id: string): Promise<string> => {
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select({ n: hrmsEmployees.fullName })
    .from(hrmsEmployees).where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, TENANT))).limit(1)));
  return rows[0]!.n;
};

async function q<T = Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T[]> {
  return (await runWithTenant(TENANT, () => db.transaction((tx) => tx.execute(query)))) as unknown as T[];
}

const patch = (id: string, payload: Record<string, unknown>, roles?: string[]) =>
  app.inject({ method: "PATCH", url: `/v1/hrms/employees/${id}`, headers: auth(roles), payload });

beforeAll(async () => {
  app = await buildApp();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsDepartments).values({ id: deptId, tenantId: TENANT, code: "NC", name: "Establishment", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(hrmsDesignations).values({ id: desigId, tenantId: TENANT, code: "NC", name: "Section Officer", createdBy: ACTOR, updatedBy: ACTOR });
  }));
});

afterAll(async () => {
  await q(sql`DELETE FROM hrms.id_cards WHERE tenant_id = ${TENANT}::uuid`);
  await q(sql`DELETE FROM scheduler.hrms_due_list WHERE tenant_id = ${TENANT}::uuid`);
  await q(sql`DELETE FROM seniority.hrms_seniority_list_entries WHERE tenant_id = ${TENANT}::uuid`);
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
    await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
    await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
  }));
  await app.close();
  await sqlClient.end();
});

describe("name correction -- route guards", () => {
  it("requires a reason: 400 REASON_REQUIRED, nothing queued, name unchanged", async () => {
    const emp = await seedEmployee();
    const publish = vi.spyOn(queue, "publish");
    const r = await patch(emp, { fullName: "Sunita Kumari" });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("REASON_REQUIRED");
    const short = await patch(emp, { fullName: "Sunita Kumari", reason: "typo" });
    expect(short.statusCode).toBe(400);
    expect(publish).not.toHaveBeenCalled();
    publish.mockRestore();
    expect(await nameOf(emp)).toBe("Sunita Devi");
  });

  it("rejects a blank / whitespace-only name with a 400 and stores nothing", async () => {
    const emp = await seedEmployee();
    for (const bad of ["", "     ", "​​"]) {
      const r = await patch(emp, { fullName: bad, reason: "Correcting a data-entry error" });
      expect(r.statusCode).toBe(400);
    }
    await drain();
    expect(await nameOf(emp)).toBe("Sunita Devi");
  });

  it("is HR-only: an employee-role caller gets 403", async () => {
    const emp = await seedEmployee();
    const r = await patch(emp, { fullName: "Sunita Kumari", reason: "Name changed after marriage" }, ["employee"]);
    expect(r.statusCode).toBe(403);
  });

  it.each(["terminated", "separated", "retired"])("is blocked for a %s employee (409 EMPLOYEE_EXITED)", async (status) => {
    const emp = await seedEmployee(status);
    const r = await patch(emp, { fullName: "Sunita Kumari", reason: "Name changed after marriage" });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("EMPLOYEE_EXITED");
    await drain();
    expect(await nameOf(emp)).toBe("Sunita Devi");
  });

  it("the consumer also refuses a stale command for an exited employee (race safety)", async () => {
    const emp = await seedEmployee("separated");
    await queue.publish(COMMANDS.employeeUpdate, {
      messageId: randomUUID(), type: COMMANDS.employeeUpdate, tenantId: TENANT, actorId: ACTOR,
      correlationId: "c", schemaVersion: "1.0",
      payload: { id: emp, tenantId: TENANT, fullName: "Sunita Kumari", reason: "Name changed after marriage" },
    });
    await drain();
    expect(await nameOf(emp)).toBe("Sunita Devi");
  });
});

describe("name correction -- applied, audited, copies", () => {
  it("trims, applies, writes one correct_name audit with old/new/reason, and refreshes live copies only", async () => {
    const emp = await seedEmployee("confirmed", "Sunita Devi");
    const activeCard = randomUUID();
    const revokedCard = randomUUID();
    const insertCard = (id: string, status: string, no: string) => q(sql`
      INSERT INTO hrms.id_cards (id, tenant_id, holder_name, designation, department, employee_id, card_number, valid_until, status, qr_payload, issued_by)
      VALUES (${id}::uuid, ${TENANT}::uuid, 'Sunita Devi', 'Section Officer', 'Establishment', ${emp}::uuid, ${no}, '2030-12-31', ${status}, 'qr', ${ACTOR}::uuid)`);
    await insertCard(activeCard, "active", `DIC/2026/${activeCard.slice(0, 6)}`);
    await insertCard(revokedCard, "revoked", `DIC/2026/${revokedCard.slice(0, 6)}`);
    await q(sql`
      INSERT INTO scheduler.hrms_due_list (tenant_id, list_kind, run_date, employee_id, employee_no, full_name, due_date, days_remaining)
      VALUES (${TENANT}::uuid, 'probation', CURRENT_DATE - 30, ${emp}::uuid, 'X', 'Sunita Devi', CURRENT_DATE - 5, 0),
             (${TENANT}::uuid, 'probation', CURRENT_DATE, ${emp}::uuid, 'X', 'Sunita Devi', CURRENT_DATE + 20, 20)`);
    const listId = randomUUID();
    await q(sql`INSERT INTO seniority.hrms_seniority_lists (id, tenant_id, as_of, status, entry_count, generated_by)
      VALUES (${listId}::uuid, ${TENANT}::uuid, CURRENT_DATE, 'approved', 1, ${ACTOR}::uuid)`);
    await q(sql`INSERT INTO seniority.hrms_seniority_list_entries (tenant_id, seniority_list_id, rank, employee_id, employee_no, full_name, designation_id, department_id, date_of_joining, qualifying_years)
      VALUES (${TENANT}::uuid, ${listId}::uuid, 1, ${emp}::uuid, 'X', 'Sunita Devi', ${desigId}::uuid, ${deptId}::uuid, '2015-01-01', 11)`);

    const r = await patch(emp, { fullName: "  Sunita Kumari  ", reason: "Name changed after marriage (gazette notification)" });
    expect(r.statusCode).toBe(202);
    await drain();

    expect(await nameOf(emp)).toBe("Sunita Kumari");

    const audits = await q<{ payload: Record<string, unknown> }>(sql`
      SELECT payload FROM _outbox.messages
       WHERE tenant_id = ${TENANT}::uuid AND payload->>'resourceId' = ${emp} AND payload->>'action' = 'correct_name'`);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.payload).toMatchObject({
      service: "hrms", resourceType: "employee", outcome: "success",
      oldValue: "Sunita Devi", newValue: "Sunita Kumari", reason: "Name changed after marriage (gazette notification)",
    });

    const cards = await q<{ id: string; holder_name: string }>(sql`SELECT id::text, holder_name FROM hrms.id_cards WHERE tenant_id = ${TENANT}::uuid AND employee_id = ${emp}::uuid`);
    expect(cards.find((c) => c.id === activeCard)!.holder_name).toBe("Sunita Kumari");
    expect(cards.find((c) => c.id === revokedCard)!.holder_name).toBe("Sunita Devi");

    const due = await q<{ run_date: string; full_name: string }>(sql`SELECT run_date::text, full_name FROM scheduler.hrms_due_list WHERE tenant_id = ${TENANT}::uuid AND employee_id = ${emp}::uuid ORDER BY run_date`);
    expect(due.map((d) => d.full_name)).toEqual(["Sunita Devi", "Sunita Kumari"]);

    const entries = await q<{ full_name: string }>(sql`SELECT full_name FROM seniority.hrms_seniority_list_entries WHERE tenant_id = ${TENANT}::uuid AND employee_id = ${emp}::uuid`);
    expect(entries[0]!.full_name).toBe("Sunita Devi");
  });

  it("an unchanged name is not a correction: no reason needed, no audit, no write", async () => {
    const emp = await seedEmployee("confirmed", "Mohd. Irfan Ansari");
    const r = await patch(emp, { fullName: "  Mohd. Irfan Ansari ", mobile: "9876543210" });
    expect(r.statusCode).toBe(202);
    await drain();
    expect(await nameOf(emp)).toBe("Mohd. Irfan Ansari");
    const audits = await q(sql`SELECT 1 FROM _outbox.messages WHERE tenant_id = ${TENANT}::uuid AND payload->>'resourceId' = ${emp} AND payload->>'action' = 'correct_name'`);
    expect(audits).toHaveLength(0);
  });

  it("a name containing markup or SQL is stored verbatim as data (output escaping, not input blocking)", async () => {
    const emp = await seedEmployee();
    const odd = `O'Brien <b>& "Sons"</b>; DROP TABLE x;--`;
    const r = await patch(emp, { fullName: odd, reason: "Verifying output escaping of unusual characters" });
    expect(r.statusCode).toBe(202);
    await drain();
    expect(await nameOf(emp)).toBe(odd);
  });
});
