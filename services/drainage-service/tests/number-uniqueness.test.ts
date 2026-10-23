/**
 * Proof that complaintNumber/hotspotCode allocation does not collide or lose
 * accepted commands under concurrent load. Both numbers are allocated by the
 * consumer from Postgres SEQUENCEs (migrations/0003_number_sequences.sql)
 * inside the insert transaction -- guaranteed unique by construction, and a
 * retry re-allocates instead of replaying a stale code.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sql } from "drizzle-orm";
import { sqlClient, db } from "../src/shared/db.js";
import { auditFailedCreate } from "../src/shared/numbers.js";
import { queue } from "../src/shared/infra.js";
import { registerComplaintConsumers } from "../src/modules/complaints/consumer.js";
import { registerHotspotConsumers } from "../src/modules/hotspots/consumer.js";
import * as complaintsRepo from "../src/modules/complaints/repo.js";
import * as hotspotsRepo from "../src/modules/hotspots/repo.js";
import { runWithTenant } from "@civitasone/db";
import { COMMANDS } from "../src/topics.js";
import { hdr, waitFor, ADMIN_ROLES, USER_ROLES, TENANT_A } from "./support.js";

// repo.findById() runs through `db`, which is wrapped with tenant-GUC
// injection (see shared/db.ts / @civitasone/db's wrapWithTenantGuc): it only
// sets the `app.tenant_id` GUC that FORCE ROW LEVEL SECURITY depends on when
// called from inside a matching runWithTenant(...) (or a live HTTP request's
// onRequest hook) context. Calling repo.findById() bare here, outside any
// such context, would not error -- it would just silently see zero rows
// (RLS-filtered), which is a materially different (and much easier to get
// wrong) failure mode than "throws". Always wrap direct repo reads/writes
// used from test code this way.
function findComplaintAsTenantA(id: string) {
  return runWithTenant(TENANT_A, () => complaintsRepo.findById(id, TENANT_A));
}
function findHotspotAsTenantA(id: string) {
  return runWithTenant(TENANT_A, () => hotspotsRepo.findById(id, TENANT_A));
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerComplaintConsumers(queue);
  registerHotspotConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

const complaintBody = { location: { ward: "9" }, complaintType: "overflow" as const, description: "concurrency test" };
const hotspotBody = { location: { ward: "9" }, category: "test", complaintCount: 1, riskScore: 20 };

describe("complaint number generation -- no collisions under concurrency", () => {
  it("50 concurrent POST /v1/drainage/complaints all succeed and persist 50 distinct complaint_numbers -- zero UNIQUE-constraint failures", async () => {
    const responses = await Promise.all(
      Array.from({ length: 50 }, () =>
        app.inject({ method: "POST", url: "/v1/drainage/complaints", headers: hdr(randomUUID(), TENANT_A, USER_ROLES), payload: complaintBody }),
      ),
    );
    for (const res of responses) expect(res.statusCode).toBe(202);
    const ids = responses.map((r) => (r.json() as { id: string }).id);
    // Poll (not a fixed sleep) until every one of the 50 rows has actually
    // landed -- under contention from other test files/DB activity running
    // concurrently, 50 consumer-processed inserts can legitimately take
    // longer than any single fixed delay would assume.
    await waitFor(async () => {
      const rows = await Promise.all(ids.map((id) => findComplaintAsTenantA(id)));
      return rows.every((r) => r != null);
    }, 15000);

    const numbers = await Promise.all(ids.map((id) => findComplaintAsTenantA(id).then((row) => row?.complaintNumber)));
    expect(numbers.every((n) => typeof n === "string")).toBe(true);
    expect(new Set(numbers).size).toBe(50);
    for (const n of numbers) expect(n).toMatch(/^DRN-\d{4}-\d{6}$/);
  });
});

describe("hotspot code generation -- no collisions under concurrency", () => {
  it("50 concurrent POST /v1/drainage/hotspots all succeed and persist 50 distinct hotspot_codes -- zero UNIQUE-constraint failures", async () => {
    const responses = await Promise.all(
      Array.from({ length: 50 }, () =>
        app.inject({ method: "POST", url: "/v1/drainage/hotspots", headers: hdr(randomUUID(), TENANT_A, ADMIN_ROLES), payload: hotspotBody }),
      ),
    );
    for (const res of responses) expect(res.statusCode).toBe(202);
    const ids = responses.map((r) => (r.json() as { id: string }).id);
    await waitFor(async () => {
      const rows = await Promise.all(ids.map((id) => findHotspotAsTenantA(id)));
      return rows.every((r) => r != null);
    }, 15000);

    const codes = await Promise.all(ids.map((id) => findHotspotAsTenantA(id).then((row) => row?.hotspotCode)));
    expect(codes.every((c) => typeof c === "string")).toBe(true);
    expect(new Set(codes).size).toBe(50);
    for (const c of codes) expect(c).toMatch(/^DRNH-\d{4}-\d{6}$/);
  });
});

describe("terminal failure of a create command is audited, never silent", () => {
  it("onOutcome(failed) records an audit.event.record outcome=failure in the outbox", async () => {
    const messageId = randomUUID();
    const hook = auditFailedCreate("hotspot.identify", "drainage_hotspot").onOutcome!;
    await hook({ messageId, tenantId: TENANT_A, topic: "drainage.hotspot.identify", status: "failed", reason: "boom" });
    const rows = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) =>
        tx.execute(sql`SELECT payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND correlation_id = ${messageId}`),
      ),
    );
    expect(rows.length).toBe(1);
    const payload = (rows[0] as { payload: Record<string, unknown> }).payload;
    expect(payload.outcome).toBe("failure");
    expect(payload.action).toBe("hotspot.identify");
  });

  it("onOutcome(succeeded) records nothing", async () => {
    const messageId = randomUUID();
    await auditFailedCreate("hotspot.identify", "drainage_hotspot").onOutcome!({ messageId, tenantId: TENANT_A, topic: "t", status: "succeeded" });
    const rows = await runWithTenant(TENANT_A, () =>
      db.transaction((tx) => tx.execute(sql`SELECT 1 FROM _outbox.messages WHERE correlation_id = ${messageId}`)),
    );
    expect(rows.length).toBe(0);
  });
});

describe("terminal failure is audited through the REGISTERED consumer (tenantScoped forwards options)", () => {
  it("a hotspot.identify command that fails on every retry leaves an audit.event.record outcome=failure in the outbox", async () => {
    const messageId = randomUUID();
    // id is not a uuid -> the INSERT inside the real consumer throws on every
    // attempt; the queue exhausts maxAttempts and fires onOutcome(failed).
    // Only reaches the hook if tenantScoped() passed the subscribe options through.
    await queue.publish(COMMANDS.hotspotIdentify, {
      messageId,
      type: COMMANDS.hotspotIdentify,
      tenantId: TENANT_A,
      actorId: "c3333333-0000-4000-8000-00000000000a",
      correlationId: messageId,
      schemaVersion: "1.0",
      payload: { id: "not-a-uuid", location: { ward: "9" }, category: "x", complaintCount: 1, riskScore: 1, tenantId: TENANT_A },
    });
    const read = () =>
      runWithTenant(TENANT_A, () =>
        db.transaction((tx) =>
          tx.execute(sql`SELECT payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND correlation_id = ${messageId}`),
        ),
      );
    await waitFor(async () => (await read()).length > 0, 15000);
    const rows = await read();
    expect(rows.length).toBe(1);
    const payload = (rows[0] as { payload: Record<string, any> }).payload;
    expect(payload.outcome).toBe("failure");
    expect(payload.action).toBe("hotspot.identify");
    expect(payload.details.status).toBe("failed");
  });
});

describe("migration 0003 seeding survives FORCE RLS (runs as the owner with no tenant GUC)", () => {
  const SEEDED = "DRNH-2026-000900";
  const migrationSql = readFileSync(
    fileURLToPath(new URL("../migrations/0003_number_sequences.sql", import.meta.url)),
    "utf8",
  );
  const hotspotId = randomUUID();
  const consumerHotspotIds: string[] = [];

  // The migration file carries its own BEGIN/COMMIT. postgres.js refuses a
  // transaction-control statement on its POOLED client (UNSAFE_TRANSACTION),
  // because the pool could split BEGIN and COMMIT across connections. Run it
  // on ONE reserved connection -- the same single-session shape as the
  // migration runner -- and release it afterwards.
  async function runMigrationFile() {
    const conn = await sqlClient.reserve();
    try {
      await conn.unsafe(migrationSql);
    } finally {
      conn.release();
    }
  }

  afterAll(async () => {
    const ids = [hotspotId, ...consumerHotspotIds];
    await runWithTenant(TENANT_A, () =>
      db.transaction(async (tx) => {
        for (const id of ids) await tx.execute(sql`DELETE FROM civitas_drainage.drainage_hotspots WHERE id = ${id}`);
      }),
    );
  });

  it("re-running the migration after rows exist seeds the sequence past the highest existing number and keeps FORCE RLS on", async () => {
    await runWithTenant(TENANT_A, () =>
      db.transaction((tx) =>
        hotspotsRepo.insert(tx, {
          id: hotspotId, tenantId: TENANT_A, hotspotCode: SEEDED,
          location: { ward: "9" }, category: "seed", complaintCount: 1, riskScore: 1,
          status: "identified", createdBy: "c3333333-0000-4000-8000-00000000000a", updatedBy: "c3333333-0000-4000-8000-00000000000a",
        } as never),
      ),
    );
    // Rewind the sequence to 1 (as a fresh/unseeded one would be), then re-run the migration
    // through the raw client: owner role, NO tenant GUC -- exactly how the migration runner connects.
    await sqlClient.unsafe(`SELECT setval('civitas_drainage.hotspot_code_seq', 1, false)`);
    await runMigrationFile();

    const next = await sqlClient.unsafe(`SELECT nextval('civitas_drainage.hotspot_code_seq')::bigint AS n`);
    expect(Number((next[0] as { n: string }).n)).toBeGreaterThan(900);

    // End to end: the next hotspot code the REAL consumer allocates must land
    // above the seeded DRNH-2026-000900, i.e. it can never re-issue it.
    const res = await app.inject({
      method: "POST", url: "/v1/drainage/hotspots", headers: hdr(randomUUID(), TENANT_A, ADMIN_ROLES), payload: hotspotBody,
    });
    expect(res.statusCode).toBe(202);
    const newId = (res.json() as { id: string }).id;
    consumerHotspotIds.push(newId);
    await waitFor(async () => (await findHotspotAsTenantA(newId)) != null, 15000);
    const code = (await findHotspotAsTenantA(newId))?.hotspotCode;
    expect(code).toMatch(/^DRNH-\d{4}-\d{6}$/);
    expect(code).not.toBe(SEEDED);
    expect(Number(/(\d+)$/.exec(code as string)![1])).toBeGreaterThan(900);

    const force = await sqlClient.unsafe(
      `SELECT relname, relforcerowsecurity FROM pg_class WHERE oid IN ('civitas_drainage.drainage_complaints'::regclass, 'civitas_drainage.drainage_hotspots'::regclass)`,
    );
    expect(force.length).toBe(2);
    for (const r of force) expect((r as { relforcerowsecurity: boolean }).relforcerowsecurity).toBe(true);
  });

  it("a second run never rewinds the sequence", async () => {
    const before = await sqlClient.unsafe(`SELECT nextval('civitas_drainage.complaint_number_seq')::bigint AS n`);
    await runMigrationFile();
    const after = await sqlClient.unsafe(`SELECT nextval('civitas_drainage.complaint_number_seq')::bigint AS n`);
    expect(Number((after[0] as { n: string }).n)).toBeGreaterThan(Number((before[0] as { n: string }).n));
  });
});
