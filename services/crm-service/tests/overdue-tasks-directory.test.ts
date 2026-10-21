/**
 * GAP-CRM-TASK-ESCALATION-02 / -03 / -01 - the overdue-task monitor.
 *
 *  - owner NAMES are resolved server-side, so a viewer who cannot list identity
 *    users (anyone who is not a platform/tenant admin) still sees a name and never
 *    an id;
 *  - the list reports the real total and pages past the first 50 (the web pages
 *    with limit/offset and meta.total);
 *  - minAgeMinutes counts the tasks a rule threshold would match right now, using
 *    the same end-of-day-UTC arithmetic as the escalation scheduler;
 *  - tenant_admin may read it (the web CRM layout already admits tenant_admin).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll, beforeAll, beforeEach } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { clearDirectoryCache } from "../src/shared/user-directory.js";

const SECRET = process.env.JWT_SECRET as string; // set by vitest.config.ts
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const OWNER_A = randomUUID();
const OWNER_UNKNOWN = randomUUID();

function headers(roles = ["crm_user"], tenant = TENANT) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": tenant,
  };
}

const originalFetch = globalThis.fetch;
let identityUsers: Array<{ id: string; name: string }> | null;
globalThis.fetch = (async (url: unknown, init?: unknown) => {
  if (String(url).includes("/identity/internal/user-summaries")) {
    if (identityUsers === null) throw new Error("connect ECONNREFUSED");
    return new Response(JSON.stringify(identityUsers), { status: 200, headers: { "content-type": "application/json" } });
  }
  return originalFetch(url as string, init as RequestInit);
}) as typeof fetch;

const app = await buildApp();

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(tenant: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenant}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

/**
 * An open task whose DATE due_date is `daysAgo` days before today's UTC date.
 *
 * UTC, not IST, on purpose: these tests measure a task's age with the scheduler's arithmetic (the due
 * DATE is end-of-day UTC), so the seed must use the same calendar the arithmetic does. Seeding with the
 * IST date made every "N days ago" task one day younger than asserted between 18:30 and 24:00 UTC,
 * when the IST date is already tomorrow's. A task seeded this way is also always past the IST overdue
 * boundary the list applies (due < today IST), because the IST date is never before the UTC date.
 */
async function seedTask(owner: string, daysAgo: number, subject = "Call back"): Promise<string> {
  const id = randomUUID();
  await scoped(TENANT, (tx) => tx`
    INSERT INTO crm.activities (id, tenant_id, actor_name, text, type, subject, status, due_date, owner_id, created_by)
    VALUES (${id}, ${TENANT}, 'Tester', 'follow up', 'task', ${subject}, 'open',
            (now() AT TIME ZONE 'UTC')::date - ${daysAgo}::int, ${owner}, ${ACTOR})
  `);
  return id;
}

beforeAll(async () => {
  await scoped(TENANT, (tx) => tx`DELETE FROM crm.activities WHERE tenant_id = ${TENANT}`);
});
beforeEach(async () => {
  identityUsers = [{ id: OWNER_A, name: "Kavita Rao" }];
  clearDirectoryCache();
  await scoped(TENANT, (tx) => tx`DELETE FROM crm.activities WHERE tenant_id = ${TENANT}`);
});
afterAll(async () => {
  globalThis.fetch = originalFetch;
  await scoped(TENANT, (tx) => tx`DELETE FROM crm.activities WHERE tenant_id = ${TENANT}`).catch(() => {});
  await app.close();
  await sqlClient.end();
});

async function list(query = "", roles?: string[], tenant?: string) {
  return app.inject({ method: "GET", url: `/v1/crm/activities/overdue-tasks${query}`, headers: headers(roles, tenant) });
}

describe("GAP-CRM-TASK-ESCALATION-02: owner names, resolved for every viewer", () => {
  it("returns ownerName for a known owner and null - never the id - for an unknown one", async () => {
    await seedTask(OWNER_A, 3, "Known owner task");
    await seedTask(OWNER_UNKNOWN, 4, "Unknown owner task");
    const res = await list("", ["crm_user"]);
    expect(res.statusCode).toBe(200);
    const byOwner = Object.fromEntries(
      (res.json().data as Array<{ ownerId: string; ownerName: string | null }>).map((t) => [t.ownerId, t.ownerName]),
    );
    expect(byOwner[OWNER_A]).toBe("Kavita Rao");
    expect(byOwner[OWNER_UNKNOWN]).toBeNull();
  });

  it("fails open: identity down means null names, and the list still loads", async () => {
    identityUsers = null;
    await seedTask(OWNER_A, 3);
    const res = await list();
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].ownerName).toBeNull();
    expect(res.json().meta.total).toBe(1);
  });
});

describe("GAP-CRM-TASK-ESCALATION-02: real total + paging beyond one page", () => {
  it("reports the true total and serves later pages (offset) in a stable worst-aged-first order", async () => {
    for (let i = 0; i < 7; i++) await seedTask(OWNER_A, 2 + i, `Task ${i}`);
    const first = await list("?limit=3&offset=0");
    expect(first.json().meta).toMatchObject({ total: 7, limit: 3, offset: 0 });
    expect(first.json().data).toHaveLength(3);
    const second = await list("?limit=3&offset=3");
    expect(second.json().data).toHaveLength(3);
    const last = await list("?limit=3&offset=6");
    expect(last.json().data).toHaveLength(1);
    const subjects = [...first.json().data, ...second.json().data, ...last.json().data].map((t: { subject: string }) => t.subject);
    // Oldest due date first: Task 6 (8 days ago) ... Task 0 (2 days ago); no overlaps, none lost.
    expect(subjects).toEqual(["Task 6", "Task 5", "Task 4", "Task 3", "Task 2", "Task 1", "Task 0"]);
  });
});

describe("GAP-CRM-TASK-ESCALATION-01: minAgeMinutes counts what a rule would match", () => {
  it("counts only tasks overdue by at least the threshold", async () => {
    // A DATE due_date counts as end-of-day UTC, so a task "N days ago" is between N-1 and N days old.
    await seedTask(OWNER_A, 2);
    await seedTask(OWNER_A, 6);
    await seedTask(OWNER_A, 12);
    const all = await list("?limit=1");
    expect(all.json().meta.total).toBe(3);
    const oneDay = await list("?limit=1&minAgeMinutes=1440");
    expect(oneDay.json().meta.total).toBe(3); // all three are at least a day past their due date
    const fiveDays = await list(`?limit=1&minAgeMinutes=${5 * 1440}`);
    expect(fiveDays.json().meta.total).toBe(2); // the 6- and 12-day ones (the 2-day one is under 5)
    const tenDays = await list(`?limit=1&minAgeMinutes=${10 * 1440}`);
    expect(tenDays.json().meta.total).toBe(1);
    const never = await list(`?limit=1&minAgeMinutes=${300 * 1440}`);
    expect(never.json().meta.total).toBe(0);
  });

  it("uses the scheduler's arithmetic (due date = end of that day, UTC)", async () => {
    await seedTask(OWNER_A, 3);
    // Compute in SQL exactly what the scheduler computes in JS, then probe either side of it.
    const [row] = await scoped(TENANT, (tx) => tx<Array<{ mins: number }>>`
      SELECT floor(extract(epoch FROM (now() - ((a.due_date + time '23:59:59') AT TIME ZONE 'UTC'))) / 60)::int AS mins
      FROM crm.activities a WHERE a.tenant_id = ${TENANT}
    `);
    const age = row!.mins;
    expect((await list(`?limit=1&minAgeMinutes=${age}`)).json().meta.total).toBe(1);
    expect((await list(`?limit=1&minAgeMinutes=${age + 2}`)).json().meta.total).toBe(0);
  });

  it("rejects an absurd or negative threshold (400)", async () => {
    expect((await list("?minAgeMinutes=-1")).statusCode).toBe(400);
    expect((await list("?minAgeMinutes=99999999")).statusCode).toBe(400);
  });
});

describe("GAP-CRM-TASK-ESCALATION-03: who may read the monitor", () => {
  it("admits crm_user, crm_admin and tenant_admin; refuses a non-CRM role", async () => {
    await seedTask(OWNER_A, 3);
    for (const r of ["crm_user", "crm_admin", "tenant_admin"]) {
      expect((await list("", [r])).statusCode, r).toBe(200);
    }
    expect((await list("", ["citizen"])).statusCode).toBe(403);
  });

  it("is tenant-scoped", async () => {
    await seedTask(OWNER_A, 3);
    const other = await list("", ["crm_user"], OTHER_TENANT);
    expect(other.statusCode).toBe(200);
    expect(other.json().meta.total).toBe(0);
  });
});
