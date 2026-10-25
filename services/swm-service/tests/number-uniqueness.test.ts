/**
 * Proof that every human-facing reference number in swm-service (complaint,
 * bulk-generator registration, collection request, field task, hotspot) is
 * allocated by the CONSUMER from a Postgres SEQUENCE
 * (migrations/0005_number_sequences.sql) inside the insert transaction:
 * unique by construction under concurrency, re-allocated (never replayed) on a
 * retry, and a command that fails for good leaves an audited failure record.
 * Same shape as drainage-service tests/number-uniqueness.test.ts (#2182).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient, db } from "../src/shared/db.js";
import { auditFailedCreate } from "../src/shared/numbers.js";
import { queue } from "../src/shared/infra.js";
import { registerComplaintConsumers } from "../src/modules/complaints/consumer.js";
import { registerBulkGeneratorConsumers } from "../src/modules/bulk_generators/consumer.js";
import { registerCollectionConsumers } from "../src/modules/collection/consumer.js";
import { registerAnalyticsConsumers } from "../src/modules/analytics/consumer.js";
import * as complaintsRepo from "../src/modules/complaints/repo.js";
import * as generatorsRepo from "../src/modules/bulk_generators/repo.js";
import * as collectionRepo from "../src/modules/collection/repo.js";
import * as hotspotsRepo from "../src/modules/analytics/repo.js";
import { COMMANDS } from "../src/topics.js";
import { hdr, waitFor, TENANT_A, ACTOR_A } from "./support.js";

const N = 50;

// Repo reads run through `db`, which only sets the app.tenant_id GUC that
// FORCE ROW LEVEL SECURITY depends on inside runWithTenant(...); a bare call
// silently sees zero rows. Always wrap direct reads this way.
const asTenantA = <T>(fn: () => Promise<T>) => runWithTenant(TENANT_A, fn);

interface Kind {
  name: string;
  url: string;
  roles: string[];
  payload: Record<string, unknown>;
  pattern: RegExp;
  read: (id: string) => Promise<string | undefined>;
}

const KINDS: Kind[] = [
  {
    name: "complaint_number", url: "/v1/swm/complaints", roles: ["swm_user"],
    payload: { complaintType: "spillage", description: "concurrency test", severity: "low" },
    pattern: /^SWM-\d{4}-\d{6}$/,
    read: (id) => asTenantA(() => complaintsRepo.findById(id, TENANT_A)).then((r) => r?.complaintNumber),
  },
  {
    name: "registration_number", url: "/v1/swm/bulk-generators", roles: ["swm_admin"],
    payload: { generatorName: "Grand Hotel", generatorType: "hotel", category: "wet", estimatedWasteKgPerDay: 200 },
    pattern: /^SWMG-\d{4}-\d{6}$/,
    read: (id) => asTenantA(() => generatorsRepo.findById(id, TENANT_A)).then((r) => r?.registrationNumber),
  },
  {
    name: "request_number", url: "/v1/swm/collection-requests", roles: ["swm_user"],
    payload: { wasteType: "bulky_item", estimatedQuantity: "2 sofas" },
    pattern: /^SWMR-\d{4}-\d{6}$/,
    read: (id) => asTenantA(() => collectionRepo.findRequestById(id, TENANT_A)).then((r) => r?.requestNumber),
  },
  {
    name: "task_number", url: "/v1/swm/field-tasks", roles: ["swm_admin"],
    payload: { routeId: "route-7", zoneId: "zone-3" },
    pattern: /^SWMT-\d{4}-\d{6}$/,
    read: (id) => asTenantA(() => collectionRepo.findTaskById(id, TENANT_A)).then((r) => r?.taskNumber),
  },
  {
    name: "hotspot_code", url: "/v1/swm/hotspots", roles: ["swm_admin"],
    payload: { category: "illegal_dumping", complaintCount: 12 },
    pattern: /^SWMH-\d{4}-\d{6}$/,
    read: (id) => asTenantA(() => hotspotsRepo.findById(id, TENANT_A)).then((r) => r?.hotspotCode),
  },
];

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerComplaintConsumers(queue);
  registerBulkGeneratorConsumers(queue);
  registerCollectionConsumers(queue);
  registerAnalyticsConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe.each(KINDS)("$name -- no collisions under concurrency", (k) => {
  it(`${N} concurrent POST ${k.url} all return 202 and persist ${N} distinct numbers`, async () => {
    const responses = await Promise.all(
      Array.from({ length: N }, () =>
        app.inject({ method: "POST", url: k.url, headers: hdr(randomUUID(), TENANT_A, k.roles), payload: k.payload }),
      ),
    );
    for (const res of responses) expect(res.statusCode).toBe(202);
    const ids = responses.map((r) => (r.json() as { id: string }).id);
    await waitFor(async () => (await Promise.all(ids.map(k.read))).every((v) => v != null), 20000);

    const numbers = await Promise.all(ids.map(k.read));
    expect(numbers.every((n) => typeof n === "string")).toBe(true);
    expect(new Set(numbers).size).toBe(N);
    for (const n of numbers) expect(n).toMatch(k.pattern);
  });
});

describe("a retried command persists exactly once", () => {
  async function publishComplaint(messageId: string, id: string) {
    await queue.publish(COMMANDS.complaintCreate, {
      messageId, type: COMMANDS.complaintCreate, tenantId: TENANT_A, actorId: ACTOR_A,
      correlationId: messageId, schemaVersion: "1.0",
      payload: { id, reportedBy: ACTOR_A, location: { ward: "9" }, complaintType: "spillage", description: "dup", photo: null, severity: "low" },
    });
  }
  const countRows = (id: string) =>
    asTenantA(() => db.transaction(async (tx) => {
      const r = (await tx.execute(sql`SELECT count(*)::int AS c FROM civitas_swm.swm_complaints WHERE id = ${id}`)) as unknown as Array<{ c: number }>;
      return r[0]!.c;
    }));

  it("the same command delivered twice (same messageId) stores one row and keeps its first number", async () => {
    const id = randomUUID();
    const messageId = randomUUID();
    await publishComplaint(messageId, id);
    await waitFor(async () => (await KINDS[0]!.read(id)) != null, 15000);
    const first = await KINDS[0]!.read(id);
    await publishComplaint(messageId, id);
    await new Promise<void>((r) => setTimeout(r, 500));
    expect(await countRows(id)).toBe(1);
    expect(await KINDS[0]!.read(id)).toBe(first);
  });

  it("a command whose first attempt fails after allocating a number is retried and stores exactly one row with a fresh number", async () => {
    const id = randomUUID();
    const spy = vi.spyOn(complaintsRepo, "insert").mockImplementationOnce(async () => {
      throw new Error("transient insert failure");
    });
    try {
      await publishComplaint(randomUUID(), id);
      await waitFor(async () => (await KINDS[0]!.read(id)) != null, 15000);
      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
    expect(await countRows(id)).toBe(1);
    expect(await KINDS[0]!.read(id)).toMatch(/^SWM-\d{4}-\d{6}$/);
  });
});

describe("terminal failure of a create command is audited, never silent", () => {
  it("onOutcome(failed) records an audit.event.record outcome=failure in the outbox", async () => {
    const messageId = randomUUID();
    await auditFailedCreate("hotspot.identify", "swm_hotspot").onOutcome!({
      messageId, tenantId: TENANT_A, topic: COMMANDS.hotspotIdentify, status: "failed", reason: "boom",
    });
    const rows = await asTenantA(() =>
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
    await auditFailedCreate("hotspot.identify", "swm_hotspot").onOutcome!({ messageId, tenantId: TENANT_A, topic: "t", status: "succeeded" });
    const rows = await asTenantA(() =>
      db.transaction((tx) => tx.execute(sql`SELECT 1 FROM _outbox.messages WHERE correlation_id = ${messageId}`)),
    );
    expect(rows.length).toBe(0);
  });

  it("a command that fails on every retry, through the REGISTERED consumer, leaves an audited failure (tenantScoped forwards options)", async () => {
    const messageId = randomUUID();
    // id is not a uuid -> the INSERT inside the real consumer throws on every attempt; the queue
    // exhausts maxAttempts and fires onOutcome(failed). Only reaches the hook if tenantScoped()
    // passed the subscribe options through.
    await queue.publish(COMMANDS.hotspotIdentify, {
      messageId, type: COMMANDS.hotspotIdentify, tenantId: TENANT_A, actorId: ACTOR_A,
      correlationId: messageId, schemaVersion: "1.0",
      payload: { id: "not-a-uuid", location: { ward: "9" }, category: "x", complaintCount: 1 },
    });
    const read = () =>
      asTenantA(() =>
        db.transaction((tx) =>
          tx.execute(sql`SELECT payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND correlation_id = ${messageId}`),
        ),
      );
    await waitFor(async () => (await read()).length > 0, 30000);
    const rows = await read();
    expect(rows.length).toBe(1);
    const payload = (rows[0] as { payload: Record<string, any> }).payload;
    expect(payload.outcome).toBe("failure");
    expect(payload.action).toBe("hotspot.identify");
    expect(payload.details.status).toBe("failed");
  }, 40000);
});

describe("migration 0005 seeding survives FORCE RLS (runs as the owner with no tenant GUC)", () => {
  const SEEDED = "SWMH-2026-000900";
  const migrationSql = readFileSync(
    fileURLToPath(new URL("../migrations/0005_number_sequences.sql", import.meta.url)),
    "utf8",
  );
  const hotspotId = randomUUID();
  const consumerHotspotIds: string[] = [];

  // The migration carries its own BEGIN/COMMIT, which postgres.js refuses on its pooled client;
  // run it on ONE reserved connection, the same single-session shape as the migration runner.
  async function runMigrationFile() {
    const conn = await sqlClient.reserve();
    try {
      await conn.unsafe(migrationSql);
    } finally {
      conn.release();
    }
  }

  afterAll(async () => {
    await asTenantA(() =>
      db.transaction(async (tx) => {
        for (const id of [hotspotId, ...consumerHotspotIds]) await tx.execute(sql`DELETE FROM civitas_swm.swm_hotspots WHERE id = ${id}`);
      }),
    );
  });

  it("re-running the migration after rows exist seeds past the highest existing number and keeps FORCE RLS on", async () => {
    await asTenantA(() =>
      db.transaction((tx) =>
        hotspotsRepo.insert(tx, {
          id: hotspotId, tenantId: TENANT_A, hotspotCode: SEEDED,
          location: { ward: "9" }, category: "seed", complaintCount: 1, riskScore: 1,
          status: "identified", createdBy: ACTOR_A, updatedBy: ACTOR_A,
        } as never),
      ),
    );
    await sqlClient.unsafe(`SELECT setval('civitas_swm.hotspot_code_seq', 1, false)`);
    await runMigrationFile();

    const next = await sqlClient.unsafe(`SELECT nextval('civitas_swm.hotspot_code_seq')::bigint AS n`);
    expect(Number((next[0] as { n: string }).n)).toBeGreaterThan(900);

    const res = await app.inject({
      method: "POST", url: "/v1/swm/hotspots", headers: hdr(randomUUID(), TENANT_A, ["swm_admin"]),
      payload: { category: "illegal_dumping", complaintCount: 3 },
    });
    expect(res.statusCode).toBe(202);
    const newId = (res.json() as { id: string }).id;
    consumerHotspotIds.push(newId);
    await waitFor(async () => (await KINDS[4]!.read(newId)) != null, 15000);
    const code = (await KINDS[4]!.read(newId)) as string;
    expect(code).toMatch(/^SWMH-\d{4}-\d{6}$/);
    expect(code).not.toBe(SEEDED);
    expect(Number(/(\d+)$/.exec(code)![1])).toBeGreaterThan(900);

    const force = await sqlClient.unsafe(
      `SELECT relforcerowsecurity FROM pg_class WHERE oid IN ('civitas_swm.swm_complaints'::regclass, 'civitas_swm.swm_bulk_generators'::regclass, 'civitas_swm.swm_collection_requests'::regclass, 'civitas_swm.swm_field_tasks'::regclass, 'civitas_swm.swm_hotspots'::regclass)`,
    );
    expect(force.length).toBe(5);
    for (const r of force) expect((r as { relforcerowsecurity: boolean }).relforcerowsecurity).toBe(true);
  });

  it("a second run never rewinds a sequence", async () => {
    const before = await sqlClient.unsafe(`SELECT nextval('civitas_swm.complaint_number_seq')::bigint AS n`);
    await runMigrationFile();
    const after = await sqlClient.unsafe(`SELECT nextval('civitas_swm.complaint_number_seq')::bigint AS n`);
    expect(Number((after[0] as { n: string }).n)).toBeGreaterThan(Number((before[0] as { n: string }).n));
  });
});
