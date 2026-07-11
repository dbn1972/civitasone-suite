/**
 * WRITE-path end-to-end smoke — REAL Postgres + the REAL worker wiring, in one
 * process. Proves a command flows: HTTP route → in-memory queue → worker router
 * (which now establishes the tenant context via runWithTenant) → module consumer
 * → db.transaction (app.tenant_id GUC set) → INSERT accepted under RLS, as the
 * NON-superuser court_svc role. Also proves the §47 config-driven validation
 * rejects an invalid courtType through the full stack (dead-lettered, never
 * written). Together with smoke.e2e.test.ts (read path) this closes the loop:
 * routes, worker, RLS (read AND write), and config validation are proven end to
 * end under a secure role — not just in mocked unit tests.
 *
 * Opt-in via COURT_E2E=1 (real DATABASE_URL / JWT_SECRET / COURT_PII_KEY). The
 * default `vitest run` skips it (the DB is mocked there).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { subscribeConsumers } from "../src/worker.js";
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";

const RUN = process.env.COURT_E2E === "1";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT = "33333333-3333-3333-3333-333333333333";
const OTHER = "44444444-4444-4444-4444-444444444444";
const ACTOR = "3333aaaa-3333-4333-8333-333333333333";

function token(tenantId: string, actorId = ACTOR, roles: string[] = ["court_admin"]): string {
  return signToken({ sub: actorId, tid: tenantId, roles, sid: "sess-wp" }, SECRET, 3600);
}

let app: FastifyInstance;

async function listCourtNames(tenantId: string): Promise<string[]> {
  const res = await app.inject({
    method: "GET",
    url: "/v1/court/courts",
    headers: { authorization: `Bearer ${token(tenantId)}` },
  });
  if (res.statusCode !== 200) return [];
  return (res.json().items as Array<{ name: string }>).map((c) => c.name);
}

async function waitFor(pred: () => Promise<boolean>, tries = 40, gapMs = 25): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    if (await pred()) return true;
    await new Promise((r) => setTimeout(r, gapMs));
  }
  return false;
}

describe.skipIf(!RUN)("court-service write-path e2e (route→queue→worker→DB under RLS)", () => {
  const validName = `WP Valid ${Date.now()}`;
  const invalidName = `WP Invalid ${Date.now()}`;

  beforeAll(async () => {
    subscribeConsumers();      // wire the REAL module consumers onto the shared queue
    await queue.start();
    app = await buildApp();
  });

  afterAll(async () => {
    await queue.stop();
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      await sql`delete from court.courts where tenant_id = ${TENANT} and name in (${validName}, ${invalidName})`;
    });
    await app.close();
    await sqlClient.end();
  });

  it("a valid create flows through the worker and lands in the DB (write-side RLS works)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/court/courts",
      headers: { authorization: `Bearer ${token(TENANT)}`, "content-type": "application/json" },
      payload: { name: validName, courtType: "tehsildar" },
    });
    expect(res.statusCode).toBe(202);
    const landed = await waitFor(async () => (await listCourtNames(TENANT)).includes(validName));
    expect(landed).toBe(true); // proves consumer INSERT was accepted under RLS with the tenant GUC set
  });

  it("the worker-written row is invisible to another tenant (RLS end-to-end)", async () => {
    expect((await listCourtNames(OTHER)).includes(validName)).toBe(false);
  });

  it("a config-invalid courtType is rejected through the full stack (never written)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/court/courts",
      headers: { authorization: `Bearer ${token(TENANT)}`, "content-type": "application/json" },
      payload: { name: invalidName, courtType: "totally_made_up_type" },
    });
    expect(res.statusCode).toBe(202); // route accepts; §47 validation happens in the consumer
    const appeared = await waitFor(async () => (await listCourtNames(TENANT)).includes(invalidName), 12, 25);
    expect(appeared).toBe(false); // consumer rejected it as NonRetryableError → dead-lettered, not persisted
  });
});
