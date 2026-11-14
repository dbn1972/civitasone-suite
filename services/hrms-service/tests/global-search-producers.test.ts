/** HRMS -> cross-module search (real DB): flag-off parity, name+number+status only, no personal data in the event. */
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenantScope } from "@civitasone/db";
import { findSensitive } from "@civitasone/search";
import { db, sqlClient } from "../src/shared/db.js";
import { insertEmployee, updateEmployee } from "../src/modules/employee/repo.js";

const T = "cccccccc-5ea0-4000-8000-000000000001";
const ACTOR = "00000000-5ea0-4000-8000-0000000000a1";
const saved = { ...process.env };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const scoped = <R,>(fn: (tx: any) => Promise<R>) => withTenantScope(db, T, fn as never) as Promise<R>;
const events = async () => (await scoped((tx) => tx.execute(sql`
  SELECT payload FROM _outbox.messages WHERE tenant_id = ${T}::uuid AND topic = 'search.index.update' ORDER BY created_at, id`))) as unknown as Array<{ payload: Record<string, unknown> }>;
const wipe = () => scoped((tx) => tx.execute(sql`DELETE FROM _outbox.messages WHERE tenant_id = ${T}::uuid`));

const emp = (no: string) => ({
  id: randomUUID(), tenantId: T, employeeNo: no, fullName: "Asha Verma", departmentId: randomUUID(), designationId: randomUUID(),
  dateOfJoining: "2020-01-15", pan: "ZZPAN1234Z", aadhaarRef: "234567890123", mobile: "9876543210", email: "asha.verma@example.org",
  bankAccountNo: "123456789012", bankIfsc: "TEST0123456", basicMinor: 9876543n, createdBy: ACTOR, updatedBy: ACTOR,
}) as Parameters<typeof insertEmployee>[1];

describe("hrms -> global search producers (real DB)", () => {
  beforeEach(async () => { delete process.env.GLOBAL_SEARCH_TENANTS; await wipe(); });
  afterEach(() => { process.env = { ...saved }; });
  afterAll(async () => { await wipe(); await sqlClient.end(); });

  it("flag off: no event", async () => {
    await scoped((tx) => insertEmployee(tx, emp("EMP-OFF-1")));
    expect(await events()).toEqual([]);
  });
  it("flag on: name, number, status, type only; salary/PAN/Aadhaar/bank/mobile/e-mail never leave the service", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = T;
    const e = emp("EMP-0001");
    await scoped((tx) => insertEmployee(tx, e));
    const ev = await events();
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({ id: e.id, tenantId: T, module: "hrms", entityType: "hrms.employee", name: "Asha Verma", refNumber: "EMP-0001", action: "upsert" });
    const wire = JSON.stringify(ev[0]!.payload);
    for (const s of ["ZZPAN1234Z", "234567890123", "9876543210", "asha.verma@example.org", "123456789012", "TEST0123456", "9876543"]) expect(wire).not.toContain(s);
    const { id: _i, tenantId: _t, ...content } = ev[0]!.payload;
    expect(findSensitive(JSON.stringify(content))).toEqual([]);
  });
  it("a status change publishes the new status", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = T;
    const e = emp("EMP-0002");
    await scoped((tx) => insertEmployee(tx, e));
    await scoped((tx) => updateEmployee(tx, e.id!, { status: "separated", updatedBy: ACTOR }));
    expect((await events()).map((x) => x.payload.status)).toEqual(["probation", "separated"]);
  });
});
