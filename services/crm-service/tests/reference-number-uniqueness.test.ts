/**
 * Proof that service-request and RTI reference numbers do not collide, or lose a
 * create, under concurrent load. Both are allocated from Postgres SEQUENCEs
 * (migrations/0179_reference_number_sequences.sql) inside the insert
 * transaction -- unique by construction -- instead of the old
 * `Date.now().toString(36).slice(-6)` suffix, which repeated within a
 * millisecond (and 500'd on rti_requests.reference_no UNIQUE).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { sql } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { sqlClient, db } from "../src/shared/db.js";
import { HttpError } from "../src/shared/context.js";
import {
  nextServiceRequestRef,
  withCreateFailureAudit,
} from "../src/shared/reference-numbers.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000179";
const ACTOR = "cccccccc-3333-4000-8000-000000000179";
const N = 50;
const MARK = `refseq-${randomUUID()}`;

const headers = () => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["crm_user"], sid: "sess-refseq" }, SECRET)}`,
  "x-tenant-id": TENANT,
});

let app: FastifyInstance;

async function asTenant<T>(fn: (tx: any) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () => db.transaction((tx) => fn(tx)));
}

async function cleanup() {
  await sqlClient
    .begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await tx`DELETE FROM crm.service_requests WHERE tenant_id = ${TENANT}`;
      await tx`DELETE FROM crm.rti_requests WHERE tenant_id = ${TENANT}`;
      await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`;
    })
    .catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
});
afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

const srBody = (i: number) => ({
  citizenName: `Citizen ${i}`,
  serviceType: "water_supply",
  subject: `${MARK} ${i}`,
  priority: "normal",
});
const rtiBody = (i: number) => ({
  section: "s.6",
  departmentRef: "Ministry of Finance",
  applicantName: `Applicant ${i}`,
  subject: `${MARK} ${i}`,
  description: "Details of disbursements for the financial year under the scheme, please.",
  feePaid: true,
  feeAmount: 10,
});

describe("service request reference numbers -- no collisions under concurrency", () => {
  it(`${N} concurrent creates give ${N} distinct persisted SRQ/YYYY/NNNNNN numbers`, async () => {
    const res = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        app.inject({ method: "POST", url: "/v1/crm/service-requests", headers: headers(), payload: srBody(i) }),
      ),
    );
    expect(res.map((r) => r.statusCode)).toEqual(Array(N).fill(201));
    const rows = await asTenant((tx) =>
      tx.execute(sql`SELECT reference_no AS ref FROM crm.service_requests WHERE tenant_id = ${TENANT} AND subject LIKE ${MARK + "%"}`),
    );
    const refs = (rows as unknown as Array<{ ref: string }>).map((r) => r.ref);
    expect(refs.length).toBe(N);
    expect(new Set(refs).size).toBe(N);
    for (const r of refs) expect(r).toMatch(/^SRQ\/\d{4}\/\d{6}$/);
    // The response carries the same persisted number.
    expect(new Set(res.map((r) => (r.json() as any).data.referenceNo)).size).toBe(N);
  });
});

describe("RTI reference numbers -- no collisions under concurrency", () => {
  it(`${N} concurrent creates give ${N} distinct persisted RTI/YYYY/DEPT/NNNNNN numbers`, async () => {
    const res = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        app.inject({ method: "POST", url: "/v1/crm/rti", headers: headers(), payload: rtiBody(i) }),
      ),
    );
    expect(res.map((r) => r.statusCode)).toEqual(Array(N).fill(201));
    const rows = await asTenant((tx) =>
      tx.execute(sql`SELECT reference_no AS ref FROM crm.rti_requests WHERE tenant_id = ${TENANT} AND subject LIKE ${MARK + "%"}`),
    );
    const refs = (rows as unknown as Array<{ ref: string }>).map((r) => r.ref);
    expect(refs.length).toBe(N);
    expect(new Set(refs).size).toBe(N);
    for (const r of refs) expect(r).toMatch(/^RTI\/\d{4}\/MINIST\/\d{6}$/);
  });
});

describe("a retried create persists exactly once and re-allocates its number", () => {
  it("an attempt that fails after drawing a number rolls back; the retry stores one row with a fresh number", async () => {
    const subject = `${MARK} retry`;
    let firstDrawn = "";
    // Attempt 1: draws a number inside the insert tx, then the tx fails -> rolled back.
    await expect(
      asTenant(async (tx) => {
        firstDrawn = await nextServiceRequestRef(tx);
        await tx.execute(sql`
          INSERT INTO crm.service_requests (tenant_id, citizen_name, service_type, subject, priority, status, reference_no, created_by, updated_by)
          VALUES (${TENANT}, 'Retry', 'water_supply', ${subject}, 'normal', 'open', ${firstDrawn}, ${ACTOR}, ${ACTOR})`);
        throw new Error("simulated crash before commit");
      }),
    ).rejects.toThrow("simulated crash");
    const after1 = await asTenant((tx) =>
      tx.execute(sql`SELECT 1 FROM crm.service_requests WHERE tenant_id = ${TENANT} AND subject = ${subject}`),
    );
    expect(after1.length).toBe(0);

    // Attempt 2 (the retry): goes through the real route.
    const res = await app.inject({
      method: "POST", url: "/v1/crm/service-requests", headers: headers(),
      payload: { citizenName: "Retry", serviceType: "water_supply", subject, priority: "normal" },
    });
    expect(res.statusCode).toBe(201);
    const rows = (await asTenant((tx) =>
      tx.execute(sql`SELECT reference_no AS ref FROM crm.service_requests WHERE tenant_id = ${TENANT} AND subject = ${subject}`),
    )) as unknown as Array<{ ref: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0]!.ref).toMatch(/^SRQ\/\d{4}\/\d{6}$/);
    expect(rows[0]!.ref).not.toBe(firstDrawn); // re-allocated, never replayed
  });
});

describe("a failed create is audited, never silent", () => {
  const read = (cid: string) =>
    asTenant((tx) =>
      tx.execute(sql`SELECT payload FROM _outbox.messages WHERE topic = 'audit.event.record' AND correlation_id = ${cid}`),
    ) as unknown as Promise<Array<{ payload: Record<string, any> }>>;

  it("a non-client failure writes an audit.event.record outcome=failure and rethrows", async () => {
    const cid = randomUUID();
    await expect(
      runWithTenant(TENANT, () =>
        withCreateFailureAudit({ tenantId: TENANT, actorId: ACTOR, correlationId: cid }, "service_request.create", "service_request", async () => {
          throw new Error("db exploded");
        }),
      ),
    ).rejects.toThrow("db exploded");
    const rows = await read(cid);
    expect(rows.length).toBe(1);
    expect(rows[0]!.payload.outcome).toBe("failure");
    expect(rows[0]!.payload.action).toBe("service_request.create");
  });

  it("a deliberate 4xx HttpError is not audited as a failure", async () => {
    const cid = randomUUID();
    await expect(
      runWithTenant(TENANT, () =>
        withCreateFailureAudit({ tenantId: TENANT, actorId: ACTOR, correlationId: cid }, "service_request.create", "service_request", async () => {
          throw new HttpError(422, "ACCOUNT_NOT_FOUND", "nope");
        }),
      ),
    ).rejects.toBeInstanceOf(HttpError);
    expect((await read(cid)).length).toBe(0);
  });
});

describe("migration 0179 seeding survives FORCE RLS and never rewinds", () => {
  const migrationSql = readFileSync(
    fileURLToPath(new URL("../migrations/0179_reference_number_sequences.sql", import.meta.url)),
    "utf8",
  );
  async function runMigrationFile() {
    const conn = await sqlClient.reserve();
    try { await conn.unsafe(migrationSql); } finally { conn.release(); }
  }

  it("re-running after rows exist seeds past the highest existing number and keeps FORCE RLS on", async () => {
    const seeded = "SRQ/2026/900000";
    await asTenant((tx) =>
      tx.execute(sql`
        INSERT INTO crm.service_requests (tenant_id, citizen_name, service_type, subject, priority, status, reference_no, created_by, updated_by)
        VALUES (${TENANT}, 'Seed', 'water_supply', ${MARK + " seed"}, 'normal', 'open', ${seeded}, ${ACTOR}, ${ACTOR})`),
    );
    await sqlClient.unsafe(`SELECT setval('crm.service_request_ref_seq', 1, false)`);
    await runMigrationFile();
    const next = await sqlClient.unsafe(`SELECT nextval('crm.service_request_ref_seq')::bigint AS n`);
    expect(Number((next[0] as { n: string }).n)).toBeGreaterThan(900000);

    const force = await sqlClient.unsafe(
      `SELECT relforcerowsecurity FROM pg_class WHERE oid IN ('crm.service_requests'::regclass, 'crm.rti_requests'::regclass)`,
    );
    expect(force.length).toBe(2);
    for (const r of force) expect((r as { relforcerowsecurity: boolean }).relforcerowsecurity).toBe(true);

    const before = await sqlClient.unsafe(`SELECT nextval('crm.rti_ref_seq')::bigint AS n`);
    await runMigrationFile();
    const after = await sqlClient.unsafe(`SELECT nextval('crm.rti_ref_seq')::bigint AS n`);
    expect(Number((after[0] as { n: string }).n)).toBeGreaterThan(Number((before[0] as { n: string }).n));
  });
});
