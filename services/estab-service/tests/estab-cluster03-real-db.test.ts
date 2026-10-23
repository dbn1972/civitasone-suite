/**
 * ESTAB gap cluster 03 (W2 rescan) against a real database.
 *
 *  - GAP-ESTAB-GUESTHOUSE-03: the booking register sends the full check-in/out INSTANTS (the form collects a
 *    time of day, IST), not dates cut to YYYY-MM-DD, so the screen can show "01 Oct 14:00" and not a made-up time.
 *  - GAP-ESTAB-HANDOVER-02/03: the held-count preview states exactly the files the handover consumer moves;
 *    the consumer moves custody of every ACTIVE file on the outgoing officer's desk, records a movement per
 *    file and one audit event for the batch; the division admin the screen admits can read the count.
 *  - GAP-ESTAB-INBOX-01: "My Desk" matches a file held under the officer's own login id AND under their hrms
 *    employee id (the id a forwarded file carries), excludes everyone else's files and other tenants', says
 *    whether the caller is an enrolled operator, and fails closed when hrms cannot confirm who they are.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";

const { resolveActorEmployeeId } = vi.hoisted(() => ({ resolveActorEmployeeId: vi.fn() }));
vi.mock("../src/shared/hrms-client.js", async (orig) => {
  const real = await orig<typeof import("../src/shared/hrms-client.js")>();
  return { ...real, resolveActorEmployeeId };
});

import { buildApp } from "../src/app.js";
import { HrmsUnavailableError } from "../src/shared/hrms-client.js";
import { db, sqlClient } from "../src/shared/db.js";
import { processed } from "../src/shared/outbox.js";
import { registerHandoverConsumers } from "../src/modules/handover/consumer.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET as string;

// One tenant per scenario: the operator-adoption and eligibility lookups are cached per tenant.
const T_DESK_NONE = "c0ff33aa-0000-4000-8000-0000000c0301"; // no operators enrolled (greenfield)
const T_DESK_ENROLLED = "c0ff33aa-0000-4000-8000-0000000c0302"; // the caller's employee is an enrolled operator
const T_DESK_OTHER_OPS = "c0ff33aa-0000-4000-8000-0000000c0303"; // operators exist, the caller is not one
const T_MAIN = "c0ff33aa-0000-4000-8000-0000000c0304"; // handover + guesthouse
const T_FOREIGN = "c0ff33aa-0000-4000-8000-0000000c0305";
const TENANTS = [T_DESK_NONE, T_DESK_ENROLLED, T_DESK_OTHER_OPS, T_MAIN, T_FOREIGN];

const ACTOR = randomUUID(); // the officer's login id (Keycloak subject)
const EMP = randomUUID(); // the same officer's hrms employee id
const OTHER_OFFICER = randomUUID();
const OUTGOING = randomUUID();
const INCOMING = randomUUID();

const headers = (tenant: string, roles: string[], sub = ACTOR) => ({
  authorization: `Bearer ${signToken({ sub, tid: tenant, roles, sid: "sess-c03" }, SECRET)}`,
  "x-tenant-id": tenant,
});

let app: FastifyInstance;

type Tx = typeof sqlClient;
async function wipe(tx: Tx) {
  for (const t of TENANTS) {
    await tx`select set_config('app.tenant_id', ${t}, true)`;
    await tx`DELETE FROM files.estab_file_movements WHERE tenant_id = ${t}`;
    await tx`DELETE FROM files.estab_charge_handover WHERE tenant_id = ${t}`;
    await tx`DELETE FROM files.estab_file_operator WHERE tenant_id = ${t}`;
    await tx`DELETE FROM files.estab_files WHERE tenant_id = ${t}`;
    await tx`DELETE FROM facilities.estab_room_bookings WHERE tenant_id = ${t}`;
  }
}

let fileSeq = 0;
async function insertFile(tx: Tx, tenant: string, holder: string, status: string, subject = "Subject") {
  const id = randomUUID();
  fileSeq += 1;
  await tx`select set_config('app.tenant_id', ${tenant}, true)`;
  await tx`INSERT INTO files.estab_files (id, tenant_id, file_no, subject, dept, current_with, status, created_by, updated_by)
           VALUES (${id}, ${tenant}, ${"C03/" + fileSeq + "/" + id.slice(0, 6)}, ${subject}, 'ADMIN', ${holder}, ${status}, ${ACTOR}, ${ACTOR})`;
  return id;
}
async function insertOperator(tx: Tx, tenant: string, employeeId: string, division = "Admin") {
  await tx`select set_config('app.tenant_id', ${tenant}, true)`;
  await tx`INSERT INTO files.estab_file_operator (id, tenant_id, employee_id, division, desk_role, active, assigned_by, created_by, updated_by)
           VALUES (${randomUUID()}, ${tenant}, ${employeeId}, ${division}, 'dealing_hand', true, ${ACTOR}, ${ACTOR}, ${ACTOR})`;
}

beforeAll(async () => { app = await buildApp(); });
afterAll(async () => {
  await app.close();
  await sqlClient.begin(async (s) => { await wipe(s as unknown as Tx); });
  await sqlClient.end();
});
beforeEach(async () => {
  resolveActorEmployeeId.mockReset().mockResolvedValue(EMP);
  await sqlClient.begin(async (s) => { await wipe(s as unknown as Tx); });
});

const get = (tenant: string, url: string, roles: string[], sub = ACTOR) =>
  app.inject({ method: "GET", url, headers: headers(tenant, roles, sub) });

// ── GUESTHOUSE-03 ───────────────────────────────────────────────────────────

describe("GET /v1/estab/guesthouse-bookings - check-in/out are instants (GAP-ESTAB-GUESTHOUSE-03)", () => {
  it("returns the booked time of day, not a date cut from it", async () => {
    const bookingId = randomUUID();
    await sqlClient.begin(async (s) => {
      const tx = s as unknown as Tx;
      await tx`select set_config('app.tenant_id', ${T_MAIN}, true)`;
      // 01 Oct 2026 14:00 IST = 08:30 UTC; check-out 04 Oct 2026 00:30 IST = 03 Oct 19:00 UTC (a different UTC day).
      await tx`INSERT INTO facilities.estab_room_bookings (id, tenant_id, room_id, guest_name, check_in, check_out, sponsor_dept, status, created_by, updated_by)
               VALUES (${bookingId}, ${T_MAIN}, ${randomUUID()}, 'Shri A. Kumar', '2026-10-01T08:30:00Z', '2026-10-03T19:00:00Z', 'Health', 'booked', ${ACTOR}, ${ACTOR})`;
    });
    const res = await get(T_MAIN, "/v1/estab/guesthouse-bookings", ["estab_officer"]);
    expect(res.statusCode).toBe(200);
    const row = (res.json() as Array<{ id: string; checkInDate: string; checkOutDate: string; department?: string; status: string }>).find((b) => b.id === bookingId);
    expect(row).toBeDefined();
    expect(row!.checkInDate).toBe("2026-10-01T08:30:00.000Z");
    expect(row!.checkOutDate).toBe("2026-10-03T19:00:00.000Z");
    expect(row!.department).toBe("Health");
    expect(row!.status).toBe("confirmed");
  });
});

// ── HANDOVER-03 / 02 ────────────────────────────────────────────────────────

async function seedDesk() {
  const ids = { active1: "", active2: "", draft: "", closed: "", archived: "", others: "", foreign: "" };
  await sqlClient.begin(async (s) => {
    const tx = s as unknown as Tx;
    ids.active1 = await insertFile(tx, T_MAIN, OUTGOING, "active");
    ids.active2 = await insertFile(tx, T_MAIN, OUTGOING, "active");
    ids.draft = await insertFile(tx, T_MAIN, OUTGOING, "draft");
    ids.closed = await insertFile(tx, T_MAIN, OUTGOING, "closed");
    ids.archived = await insertFile(tx, T_MAIN, OUTGOING, "archived");
    ids.others = await insertFile(tx, T_MAIN, OTHER_OFFICER, "active");
    ids.foreign = await insertFile(tx, T_FOREIGN, OUTGOING, "active");
  });
  return ids;
}

describe("GET /v1/estab/files/held-count (GAP-ESTAB-HANDOVER-03)", () => {
  it("counts live files and, separately, the active files a handover will move; never another officer's or tenant's", async () => {
    await seedDesk();
    const res = await get(T_MAIN, `/v1/estab/files/held-count?officerId=${OUTGOING}`, ["estab_officer"]);
    expect(res.statusCode).toBe(200);
    // live = active x2 + draft + closed (archived is terminal); movable = the two active files.
    expect(res.json()).toEqual({ officerId: OUTGOING, count: 4, movableCount: 2 });
  });

  it("is readable by the division admin the charge-handover screen admits, and refused to an unrelated role", async () => {
    await seedDesk();
    const ok = await get(T_MAIN, `/v1/estab/files/held-count?officerId=${OUTGOING}`, ["estab_division_admin"]);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().movableCount).toBe(2);
    const no = await get(T_MAIN, `/v1/estab/files/held-count?officerId=${OUTGOING}`, ["hr_admin"]);
    expect(no.statusCode).toBe(403);
  });
});

function wireTenantAwareQueue<Q extends Queue>(q: Q): Q {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) => rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}
async function waitProcessed(messageId: string, ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const rows = await runWithTenant(T_MAIN, () => db.transaction((tx) => tx.select().from(processed).where(eq(processed.messageId, messageId))));
    if (rows.length === 1) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error("handover command was not processed in time");
}
const holderOf = async (fileId: string) => {
  const rows = await runWithTenant(T_MAIN, () => db.transaction((tx) => tx.execute(sql`SELECT current_with FROM files.estab_files WHERE id = ${fileId}`)));
  return (rows as unknown as Array<{ current_with: string }>)[0]?.current_with;
};

describe("the handover consumer (GAP-ESTAB-HANDOVER-02/03)", () => {
  it("moves custody of exactly the files the preview counted, one movement per file, one audit event for the batch", async () => {
    const ids = await seedDesk();
    const preview = (await get(T_MAIN, `/v1/estab/files/held-count?officerId=${OUTGOING}`, ["estab_officer"])).json() as { movableCount: number };

    const q = wireTenantAwareQueue(new MemoryQueue());
    registerHandoverConsumers(q);
    await q.start();
    const handoverId = randomUUID();
    const messageId = randomUUID();
    await q.publish(COMMANDS.handoverCreate, {
      messageId, type: COMMANDS.handoverCreate, tenantId: T_MAIN, actorId: ACTOR, correlationId: "c03-handover", schemaVersion: "1.0",
      payload: { id: handoverId, tenantId: T_MAIN, fromOfficerId: OUTGOING, toOfficerId: INCOMING, reason: "transfer", remarks: "posting order" },
    });
    await waitProcessed(messageId);
    await q.stop();

    // Custody: the two active files moved; the draft, the closed file and the archived one did not; nor did anyone else's.
    expect(await holderOf(ids.active1)).toBe(INCOMING);
    expect(await holderOf(ids.active2)).toBe(INCOMING);
    for (const stays of [ids.draft, ids.closed, ids.archived]) expect(await holderOf(stays)).toBe(OUTGOING);
    expect(await holderOf(ids.others)).toBe(OTHER_OFFICER);

    // The handover record states what moved, and it equals what the preview promised.
    const [ho] = (await runWithTenant(T_MAIN, () => db.transaction((tx) => tx.execute(sql`SELECT status, file_count FROM files.estab_charge_handover WHERE id = ${handoverId}`))) as unknown as Array<{ status: string; file_count: number }>);
    expect(ho).toEqual({ status: "completed", file_count: 2 });
    expect(ho!.file_count).toBe(preview.movableCount);

    // A movement per moved file on its timeline.
    const moves = (await runWithTenant(T_MAIN, () => db.transaction((tx) => tx.execute(sql`SELECT file_id, from_officer_id, to_officer_id, action FROM files.estab_file_movements WHERE tenant_id = ${T_MAIN}`)))) as unknown as Array<{ file_id: string; from_officer_id: string; to_officer_id: string; action: string }>;
    expect(moves.map((m) => m.file_id).sort()).toEqual([ids.active1, ids.active2].sort());
    for (const m of moves) expect(m).toMatchObject({ from_officer_id: OUTGOING, to_officer_id: INCOMING, action: "charge_handover" });

    // One audit event for the batch, carrying the count.
    const audits = (await runWithTenant(T_MAIN, () => db.transaction((tx) => tx.execute(sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${T_MAIN} AND topic = 'audit.event.record'`)))) as unknown as Array<{ payload: { action: string; resourceId: string; metadata?: { fileCount: number; from: string; to: string } } }>;
    const batch = audits.map((a) => a.payload).filter((p) => p.action === "charge.handover" && p.resourceId === handoverId);
    expect(batch).toHaveLength(1);
    expect(batch[0]!.metadata).toMatchObject({ fileCount: 2, from: OUTGOING, to: INCOMING });
  });
});

describe("POST /v1/estab/handovers authority (GAP-ESTAB-HANDOVER-02)", () => {
  const payload = () => ({ fromOfficerId: OUTGOING, toOfficerId: INCOMING, reason: "transfer" });
  const post = (roles: string[], body: unknown) =>
    app.inject({ method: "POST", url: "/v1/estab/handovers", headers: headers(T_MAIN, roles), payload: body as object });

  it("a clerk-level estab_officer cannot move another desk's files (403)", async () => {
    expect((await post(["estab_officer"], payload())).statusCode).toBe(403);
  });
  it("an administrator is accepted (202)", async () => {
    expect((await post(["estab_division_admin"], payload())).statusCode).toBe(202);
    expect((await post(["estab_admin"], payload())).statusCode).toBe(202);
  });
  it("handing a desk to the same officer is refused (400), not recorded as a no-op charge transfer", async () => {
    const res = await post(["estab_admin"], { fromOfficerId: OUTGOING, toOfficerId: OUTGOING, reason: "transfer" });
    expect(res.statusCode).toBe(400);
  });
});

// ── INBOX-01 ────────────────────────────────────────────────────────────────

describe("GET /v1/estab/files/mine - My Desk (GAP-ESTAB-INBOX-01)", () => {
  it("lists files held under the officer's login id AND under their hrms employee id, and nobody else's", async () => {
    let own = "", forwarded = "", others = "", archived = "", foreign = "";
    await sqlClient.begin(async (s) => {
      const tx = s as unknown as Tx;
      own = await insertFile(tx, T_DESK_NONE, ACTOR, "draft", "Opened by me");
      forwarded = await insertFile(tx, T_DESK_NONE, EMP, "active", "Forwarded to me");
      others = await insertFile(tx, T_DESK_NONE, OTHER_OFFICER, "active", "On a colleague's desk");
      archived = await insertFile(tx, T_DESK_NONE, EMP, "archived", "Archived");
      foreign = await insertFile(tx, T_FOREIGN, EMP, "active", "Another tenant");
    });
    const res = await get(T_DESK_NONE, "/v1/estab/files/mine", ["estab_officer"]);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ id: string }>; employeeId: string | null; operator: { adopted: boolean; enrolled: boolean } };
    const got = body.data.map((f) => f.id).sort();
    expect(got).toEqual([own, forwarded].sort());
    expect(got).not.toContain(others);
    expect(got).not.toContain(archived);
    expect(got).not.toContain(foreign);
    expect(body.employeeId).toBe(EMP);
    expect(resolveActorEmployeeId).toHaveBeenCalledWith(T_DESK_NONE, ACTOR);
    // Greenfield tenant: the operator model is not in use, so nobody is told they are "not enrolled".
    expect(body.operator).toEqual({ adopted: false, enrolled: false });
  });

  it("reports an enrolled operator", async () => {
    await sqlClient.begin(async (s) => { await insertOperator(s as unknown as Tx, T_DESK_ENROLLED, EMP); });
    const body = (await get(T_DESK_ENROLLED, "/v1/estab/files/mine", ["estab_officer"])).json() as { operator: { adopted: boolean; enrolled: boolean } };
    expect(body.operator).toEqual({ adopted: true, enrolled: true });
  });

  it("reports a caller who is not an enrolled operator in a tenant that uses the operator model", async () => {
    await sqlClient.begin(async (s) => { await insertOperator(s as unknown as Tx, T_DESK_OTHER_OPS, OTHER_OFFICER); });
    const body = (await get(T_DESK_OTHER_OPS, "/v1/estab/files/mine", ["estab_officer"])).json() as { data: unknown[]; operator: { adopted: boolean; enrolled: boolean } };
    expect(body.operator).toEqual({ adopted: true, enrolled: false });
    expect(body.data).toEqual([]);
  });

  it("an account with no linked employee still sees the files it opened itself, and is not an operator", async () => {
    resolveActorEmployeeId.mockResolvedValue(null);
    let own = "";
    await sqlClient.begin(async (s) => {
      const tx = s as unknown as Tx;
      own = await insertFile(tx, T_DESK_NONE, ACTOR, "active");
      await insertFile(tx, T_DESK_NONE, EMP, "active");
    });
    const body = (await get(T_DESK_NONE, "/v1/estab/files/mine", ["estab_officer"])).json() as { data: Array<{ id: string }>; employeeId: string | null; operator: { enrolled: boolean } };
    expect(body.data.map((f) => f.id)).toEqual([own]);
    expect(body.employeeId).toBeNull();
    expect(body.operator.enrolled).toBe(false);
  });

  it("fails closed (503) when hrms cannot confirm who the caller is, rather than showing a partial desk", async () => {
    resolveActorEmployeeId.mockRejectedValue(new HrmsUnavailableError("hrms down"));
    await sqlClient.begin(async (s) => { await insertFile(s as unknown as Tx, T_DESK_NONE, ACTOR, "active"); });
    const res = await get(T_DESK_NONE, "/v1/estab/files/mine", ["estab_officer"]);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: "HRMS_UNAVAILABLE" });
  });

  it("a login id that is not a UUID has no desk and never reaches hrms", async () => {
    const res = await get(T_DESK_NONE, "/v1/estab/files/mine", ["estab_officer"], "user-001");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ data: [], operator: { enrolled: false } });
    expect(resolveActorEmployeeId).not.toHaveBeenCalled();
  });

  it("is refused to a role outside the estab readers", async () => {
    expect((await get(T_DESK_NONE, "/v1/estab/files/mine", ["hr_admin"])).statusCode).toBe(403);
  });
});
