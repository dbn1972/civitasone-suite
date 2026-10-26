/**
 * Proof that every human-facing reference number asset-service issues
 * (streetlight fault/request, water application/connection/bill, tanker
 * booking) is allocated from a Postgres SEQUENCE inside the consumer's insert
 * transaction (migrations/0041_reference_number_sequences.sql), so:
 *   - 50 concurrent creates of each type persist 50 DISTINCT numbers;
 *   - a retried command persists exactly once (and re-allocates a number);
 *   - a command that fails for good leaves an audited failure record;
 *   - re-running the migration seeds past existing rows and keeps FORCE RLS on.
 * The old generators were `PREFIX-${Date.now().toString(36)}-${per-process counter}`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq, inArray, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue as appQueue } from "../src/shared/infra.js";
import { auditFailedCreate } from "../src/shared/numbers.js";
import { COMMANDS } from "../src/topics.js";
import { drainOrFail } from "../../../vitest.drain";
import {
  assetStreetlights, assetStreetlightFaults, assetStreetlightRequests,
} from "../src/modules/streetlight/schema.js";
import { assetWaterApplications, assetWaterConnections } from "../src/modules/water-connections/schema.js";
import { assetWaterBills } from "../src/modules/water-metering/schema.js";
import { assetWaterTankerBookings } from "../src/modules/water-tanker/schema.js";
import * as streetlightRepo from "../src/modules/streetlight/repo.js";
import * as waterConnectionsRepo from "../src/modules/water-connections/repo.js";
import * as waterMeteringRepo from "../src/modules/water-metering/repo.js";
import * as waterTankerRepo from "../src/modules/water-tanker/repo.js";
import { registerStreetlightConsumers } from "../src/modules/streetlight/consumer.js";
import { registerWaterConnectionConsumers } from "../src/modules/water-connections/consumer.js";
import { registerWaterMeteringConsumers } from "../src/modules/water-metering/consumer.js";
import { registerWaterTankerConsumers } from "../src/modules/water-tanker/consumer.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000a9";
const ACTOR = "cccccccc-3333-4000-8000-0000000000a9";
const N = 50;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
function asTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () => db.transaction(fn)) as Promise<T>;
}
const headers = () => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["super_admin"], sid: "s-numbers" }, SECRET, 3600)}`,
});

let app: FastifyInstance;
let streetlightId: string;
const drain = () => drainOrFail(appQueue);

beforeAll(async () => {
  registerStreetlightConsumers(appQueue);
  registerWaterConnectionConsumers(appQueue);
  registerWaterMeteringConsumers(appQueue);
  registerWaterTankerConsumers(appQueue);
  await appQueue.start();
  app = await buildApp();
  await app.ready();

  const res = await app.inject({
    method: "POST", url: "/v1/assets/streetlights", headers: headers(),
    payload: { poleId: `POLE-${randomUUID().slice(0, 8)}`, lampType: "led", wattage: 60 },
  });
  expect(res.statusCode).toBe(202);
  streetlightId = res.json().data.id;
  await drain();
});

afterAll(async () => {
  await asTenant(async (tx) => {
    await tx.delete(assetWaterBills).where(eq(assetWaterBills.tenantId, TENANT));
    await tx.delete(assetWaterConnections).where(eq(assetWaterConnections.tenantId, TENANT));
    await tx.delete(assetWaterApplications).where(eq(assetWaterApplications.tenantId, TENANT));
    await tx.delete(assetWaterTankerBookings).where(eq(assetWaterTankerBookings.tenantId, TENANT));
    await tx.delete(assetStreetlightFaults).where(eq(assetStreetlightFaults.tenantId, TENANT));
    await tx.delete(assetStreetlightRequests).where(eq(assetStreetlightRequests.tenantId, TENANT));
    await tx.delete(assetStreetlights).where(eq(assetStreetlights.tenantId, TENANT));
  });
  await app.close();
  await sqlClient.end();
});

interface Kind {
  name: string;
  prefix: string;
  command: string;
  /** HTTP request that creates one row. */
  post: (prereq: unknown) => { url: string; payload: Record<string, unknown> };
  /** Optional prerequisite rows (one per concurrent create). */
  prereq?: (n: number) => Promise<unknown[]>;
  /** Command payload for a hand-published envelope (retry tests). */
  payload: (id: string) => Record<string, unknown>;
  numbers: (ids: string[]) => Promise<string[]>;
  repo: { mod: Record<string, unknown>; fn: string };
}

const kinds: Kind[] = [
  {
    name: "streetlight fault", prefix: "SLF", command: COMMANDS.streetlightFaultReport,
    post: () => ({ url: "/v1/assets/streetlight-faults", payload: { streetlightId, faultType: "flickering" } }),
    payload: (id) => ({ id, tenantId: TENANT, streetlightId, faultType: "dim" }),
    numbers: (ids) => asTenant((tx) => tx.select({ n: assetStreetlightFaults.faultNumber }).from(assetStreetlightFaults).where(inArray(assetStreetlightFaults.id, ids))).then((r) => r.map((x) => x.n)),
    repo: { mod: streetlightRepo, fn: "insertFault" },
  },
  {
    name: "streetlight request", prefix: "SLR", command: COMMANDS.streetlightRequestCreate,
    post: () => ({ url: "/v1/assets/streetlight-requests", payload: { requestType: "new_light" } }),
    payload: (id) => ({ id, tenantId: TENANT, requestType: "relocation" }),
    numbers: (ids) => asTenant((tx) => tx.select({ n: assetStreetlightRequests.requestNumber }).from(assetStreetlightRequests).where(inArray(assetStreetlightRequests.id, ids))).then((r) => r.map((x) => x.n)),
    repo: { mod: streetlightRepo, fn: "insertRequest" },
  },
  {
    name: "water application", prefix: "WA", command: COMMANDS.waterApplicationCreate,
    post: () => ({ url: "/v1/assets/water/applications", payload: { applicantName: "Ravi Kumar", applicantPhone: "9876543210", connectionType: "domestic", pipeSize: "15mm" } }),
    payload: (id) => ({ id, tenantId: TENANT, applicantName: "Sita Devi", applicantPhone: "9876543211", connectionType: "domestic", pipeSize: "15mm" }),
    numbers: (ids) => asTenant((tx) => tx.select({ n: assetWaterApplications.applicationNumber }).from(assetWaterApplications).where(inArray(assetWaterApplications.id, ids))).then((r) => r.map((x) => x.n)),
    repo: { mod: waterConnectionsRepo, fn: "insertApplication" },
  },
  {
    name: "water connection", prefix: "WC", command: COMMANDS.waterConnectionInstall,
    prereq: async (n) => {
      const ids = Array.from({ length: n }, () => randomUUID());
      for (const id of ids) {
        await appQueue.publish(COMMANDS.waterApplicationCreate, {
          messageId: randomUUID(), type: COMMANDS.waterApplicationCreate, tenantId: TENANT, actorId: ACTOR,
          correlationId: randomUUID(), schemaVersion: "1.0",
          payload: { id, tenantId: TENANT, applicantName: "Prereq", applicantPhone: "9876543212", connectionType: "domestic" },
        });
      }
      await drain();
      return ids;
    },
    post: (applicationId) => ({ url: `/v1/assets/water/applications/${applicationId as string}/install`, payload: {} }),
    payload: (id) => ({ id, tenantId: TENANT, applicationId: undefined }),
    numbers: (ids) => asTenant((tx) => tx.select({ n: assetWaterConnections.connectionNumber }).from(assetWaterConnections).where(inArray(assetWaterConnections.id, ids))).then((r) => r.map((x) => x.n)),
    repo: { mod: waterConnectionsRepo, fn: "insertConnection" },
  },
  {
    name: "water bill", prefix: "WB", command: COMMANDS.waterBillGenerate,
    post: () => ({ url: "/v1/assets/water/bills/generate", payload: { connectionId: randomUUID(), readingId: randomUUID(), consumptionKl: 10, ratePerKl: 5000, billingPeriod: "2026-10", dueDate: "2026-11-05" } }),
    payload: (id) => ({ id, tenantId: TENANT, connectionId: randomUUID(), readingId: randomUUID(), consumptionKl: 7, ratePerKl: 5000, billingPeriod: "2026-10", dueDate: "2026-11-05" }),
    numbers: (ids) => asTenant((tx) => tx.select({ n: assetWaterBills.billNumber }).from(assetWaterBills).where(inArray(assetWaterBills.id, ids))).then((r) => r.map((x) => x.n)),
    repo: { mod: waterMeteringRepo, fn: "insertBill" },
  },
  {
    name: "water tanker booking", prefix: "WT", command: COMMANDS.waterTankerBookingCreate,
    post: () => ({ url: "/v1/assets/water/tanker-bookings", payload: { tankerCapacityLitres: 10000, requestedDate: "2026-11-01" } }),
    payload: (id) => ({ id, tenantId: TENANT, tankerCapacityLitres: 5000, requestedDate: "2026-11-02" }),
    numbers: (ids) => asTenant((tx) => tx.select({ n: assetWaterTankerBookings.bookingNumber }).from(assetWaterTankerBookings).where(inArray(assetWaterTankerBookings.id, ids))).then((r) => r.map((x) => x.n)),
    repo: { mod: waterTankerRepo, fn: "insertBooking" },
  },
];

function envelope(command: string, payload: Record<string, unknown>, messageId = randomUUID()) {
  return {
    messageId, type: command, tenantId: TENANT, actorId: ACTOR,
    correlationId: messageId, schemaVersion: "1.0", payload,
  };
}

describe.each(kinds)("$name number -- no collisions under concurrency", (kind) => {
  it(`${N} concurrent creates persist ${N} distinct ${kind.prefix}-YYYY-NNNNNN numbers`, async () => {
    const prereqs = kind.prereq ? await kind.prereq(N) : Array.from({ length: N }, () => undefined);
    const responses = await Promise.all(prereqs.map((p) => {
      const { url, payload } = kind.post(p);
      return app.inject({ method: "POST", url, headers: headers(), payload });
    }));
    for (const r of responses) expect(r.statusCode).toBe(202);
    const ids = responses.map((r) => r.json().data.id as string);
    expect(new Set(ids).size).toBe(N);
    await drain();

    const numbers = await kind.numbers(ids);
    expect(numbers.length).toBe(N);
    for (const n of numbers) expect(n).toMatch(new RegExp(`^${kind.prefix}-\\d{4}-\\d{6}$`));
    expect(new Set(numbers).size).toBe(N);
  });
});

describe.each(kinds)("$name -- a retried command persists exactly once", (kind) => {
  it("a transient insert failure is retried (number re-allocated) and the row exists once", async () => {
    const spy = vi.spyOn(kind.repo.mod as Record<string, (...a: unknown[]) => unknown>, kind.repo.fn);
    spy.mockImplementationOnce(() => { throw new Error("transient failure"); });
    const id = randomUUID();
    let payload = kind.payload(id);
    if (kind.prefix === "WC") {
      const [applicationId] = await kind.prereq!(1);
      payload = { id, tenantId: TENANT, applicationId };
    }
    const messageId = randomUUID();
    await appQueue.publish(kind.command, envelope(kind.command, payload, messageId));
    await drain();
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2); // 1st attempt threw, retry went through
    spy.mockRestore();

    const first = await kind.numbers([id]);
    expect(first.length).toBe(1);
    expect(first[0]).toMatch(new RegExp(`^${kind.prefix}-\\d{4}-\\d{6}$`));

    // The same message redelivered after success must not create a second row nor a new number.
    await appQueue.publish(kind.command, envelope(kind.command, payload, messageId));
    await drain();
    expect(await kind.numbers([id])).toEqual(first);
  });
});

describe("terminal failure of a create command is audited, never silent", () => {
  it("onOutcome(failed) records an audit.event.record outcome=failure in the outbox", async () => {
    const messageId = randomUUID();
    await auditFailedCreate("fault_report", "streetlight_fault").onOutcome!({
      messageId, tenantId: TENANT, topic: COMMANDS.streetlightFaultReport, status: "failed", reason: "boom",
    });
    const rows = await asTenant((tx) =>
      tx.execute(sql`SELECT payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND correlation_id = ${messageId}`));
    expect(rows.length).toBe(1);
    const payload = (rows[0] as { payload: Record<string, unknown> }).payload;
    expect(payload.outcome).toBe("failure");
    expect(payload.action).toBe("fault_report");
  });

  it("onOutcome(succeeded) records nothing", async () => {
    const messageId = randomUUID();
    await auditFailedCreate("x", "y").onOutcome!({ messageId, tenantId: TENANT, topic: "t", status: "succeeded" });
    const rows = await asTenant((tx) => tx.execute(sql`SELECT 1 FROM _outbox.messages WHERE correlation_id = ${messageId}`));
    expect(rows.length).toBe(0);
  });

  it("a registered consumer whose command fails on every retry leaves an audited failure (options reach the queue)", async () => {
    const messageId = randomUUID();
    // id is not a uuid -> the INSERT throws on every attempt; the queue exhausts
    // maxAttempts and fires onOutcome(failed). Reaches the hook only if
    // tenantScoped() forwards the subscribe options.
    await appQueue.publish(COMMANDS.waterTankerBookingCreate, envelope(
      COMMANDS.waterTankerBookingCreate,
      { id: "not-a-uuid", tenantId: TENANT, tankerCapacityLitres: 5000, requestedDate: "2026-11-02" },
      messageId,
    ));
    await drain();
    const rows = await asTenant((tx) =>
      tx.execute(sql`SELECT payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND correlation_id = ${messageId}`));
    expect(rows.length).toBe(1);
    const payload = (rows[0] as { payload: Record<string, any> }).payload;
    expect(payload.outcome).toBe("failure");
    expect(payload.action).toBe("create");
    expect(payload.resourceType).toBe("water_tanker_booking");
  });
});

describe("migration 0041 seeding survives FORCE RLS (runs as the owner with no tenant GUC)", () => {
  const migrationSql = readFileSync(
    fileURLToPath(new URL("../migrations/0041_reference_number_sequences.sql", import.meta.url)),
    "utf8",
  );
  const SEEDED = "WT-2026-000900";
  const seededId = randomUUID();

  // The file carries its own BEGIN/COMMIT; postgres.js refuses transaction-control
  // statements on its POOLED client, so run it on ONE reserved connection (the same
  // single-session shape as the migration runner).
  async function runMigrationFile() {
    const conn = await sqlClient.reserve();
    try { await conn.unsafe(migrationSql); } finally { conn.release(); }
  }

  it("re-running the migration after rows exist seeds the sequence past the highest existing number and keeps FORCE RLS on", async () => {
    await asTenant((tx) => waterTankerRepo.insertBooking(tx, {
      id: seededId, tenantId: TENANT, bookingNumber: SEEDED, requestedBy: ACTOR,
      tankerCapacityLitres: 5000, requestedDate: "2026-11-03", feeMinor: 500_00n,
      createdBy: ACTOR, updatedBy: ACTOR,
    } as never));
    // Rewind (as an unseeded sequence would be), then re-run the migration through the raw client.
    await sqlClient.unsafe(`SELECT setval('water_tanker.booking_number_seq', 1, false)`);
    await runMigrationFile();

    const next = await sqlClient.unsafe(`SELECT nextval('water_tanker.booking_number_seq')::bigint AS n`);
    expect(Number((next[0] as { n: string }).n)).toBeGreaterThan(900);

    const force = await sqlClient.unsafe(
      `SELECT relname, relforcerowsecurity FROM pg_class WHERE oid IN (
         'streetlight.asset_streetlight_faults'::regclass, 'streetlight.asset_streetlight_requests'::regclass,
         'water_connections.asset_water_applications'::regclass, 'water_connections.asset_water_connections'::regclass,
         'water_metering.asset_water_bills'::regclass, 'water_tanker.asset_water_tanker_bookings'::regclass)`,
    );
    expect(force.length).toBe(6);
    for (const r of force) expect((r as { relforcerowsecurity: boolean }).relforcerowsecurity).toBe(true);
  });

  it("a second run never rewinds any sequence", async () => {
    const seqs = [
      "streetlight.fault_number_seq", "streetlight.request_number_seq", "water_connections.application_number_seq",
      "water_connections.connection_number_seq", "water_metering.bill_number_seq", "water_tanker.booking_number_seq",
    ];
    const read = async (s: string) => Number(((await sqlClient.unsafe(`SELECT nextval('${s}')::bigint AS n`))[0] as { n: string }).n);
    const before = await Promise.all(seqs.map(read));
    await runMigrationFile();
    const after = await Promise.all(seqs.map(read));
    after.forEach((n, i) => expect(n).toBeGreaterThan(before[i]!));
  });
});
