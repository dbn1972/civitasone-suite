/**
 * Direct-SQL proof that FORCE ROW LEVEL SECURITY on every civitas_sewerage.*
 * table is what actually stops a cross-tenant leak — independent of and
 * unaided by every repo.ts function's own `eq(sewerageX.tenantId, tenantId)`
 * WHERE clause (see e.g. billing/repo.ts's findById). That app-level filter
 * is real defense-in-depth and every route test in this suite exercises it,
 * but a suite that only ever queries through those filtered repo functions
 * cannot tell a real RLS policy from a no-op one: TENANT_B's own request
 * always carries `tenantId = TENANT_B`, so it would exclude TENANT_A's rows
 * even if RLS silently did nothing at all.
 *
 * This file bypasses the repo layer entirely and issues a raw, UNFILTERED
 * `SELECT * FROM civitas_sewerage.<table>` after setting only the
 * `app.tenant_id` session GUC the same way db.transaction() does (see
 * @civitasone/db's tenant-scope.ts) — mimicking the failure mode RLS
 * actually guards against: a future repo function that forgets its own
 * tenant_id filter. With FORCE ROW LEVEL SECURITY in place (see
 * migrations/0001_initial.sql) this must still return zero cross-tenant
 * rows purely from the policy.
 *
 * Verified to have real teeth: with `ALTER TABLE civitas_sewerage.<table>
 * NO FORCE ROW LEVEL SECURITY` temporarily applied against a fresh isolated
 * Postgres container (sewerage_svc is the table OWNER, so without FORCE it
 * bypasses RLS like any owner), every test below was confirmed to FAIL —
 * the raw query returned the other tenant's row. FORCE was then restored
 * and this file re-run to confirm it passes again. See this PR's
 * description for the full sabotage/restore transcript.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerConnectionConsumers } from "../src/modules/connections/consumer.js";
import { registerBillingConsumers } from "../src/modules/billing/consumer.js";
import { registerDesludgingConsumers } from "../src/modules/desludging/consumer.js";
import { registerComplaintConsumers } from "../src/modules/complaints/consumer.js";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const TENANT_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const ACTOR_A = "cccccccc-0000-4000-8000-0000000000ac";

function hdr(tenant: string, roles: string[] = ["sewerage_admin"]): { authorization: string; "x-tenant-id": string } {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR_A, tid: tenant, roles, sid: "test-session" }, SECRET, 3600)}`,
    "x-tenant-id": tenant,
  };
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  registerConnectionConsumers(queue);
  registerBillingConsumers(queue);
  registerDesludgingConsumers(queue);
  registerComplaintConsumers(queue);
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

/** Raw, tenant-filter-free read: sets ONLY the RLS session GUC, nothing else. */
async function rawSelectAsTenant(table: string, tenantId: string): Promise<Array<{ id: string; tenant_id: string }>> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return tx.unsafe(`SELECT id, tenant_id FROM civitas_sewerage.${table}`) as unknown as Promise<Array<{ id: string; tenant_id: string }>>;
  });
}

describe("RLS — raw unfiltered query proof (bypasses app-level tenant filters)", () => {
  it("sewerage_complaints: tenant B's raw unfiltered SELECT never returns tenant A's row", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/sewerage/complaints", headers: hdr(TENANT_A, ["sewerage_user"]),
      payload: { complaintType: "blockage", description: "RLS probe — tenant A" },
    });
    expect(create.statusCode).toBe(202);
    const { id } = create.json() as { id: string };
    await queue.drain();

    const rowsAsA = await rawSelectAsTenant("sewerage_complaints", TENANT_A);
    expect(rowsAsA.some((r) => r.id === id)).toBe(true);

    const rowsAsB = await rawSelectAsTenant("sewerage_complaints", TENANT_B);
    expect(rowsAsB.some((r) => r.id === id)).toBe(false);
    expect(rowsAsB.every((r) => r.tenant_id === TENANT_B)).toBe(true);
  });

  it("sewerage_desludging_bookings: tenant B's raw unfiltered SELECT never returns tenant A's row", async () => {
    const create = await app.inject({
      method: "POST", url: "/v1/sewerage/desludging", headers: hdr(TENANT_A, ["sewerage_user"]),
      payload: { tankCapacityLitres: 1500 },
    });
    expect(create.statusCode).toBe(202);
    const { id } = create.json() as { id: string };
    await queue.drain();

    const rowsAsA = await rawSelectAsTenant("sewerage_desludging_bookings", TENANT_A);
    expect(rowsAsA.some((r) => r.id === id)).toBe(true);

    const rowsAsB = await rawSelectAsTenant("sewerage_desludging_bookings", TENANT_B);
    expect(rowsAsB.some((r) => r.id === id)).toBe(false);
    expect(rowsAsB.every((r) => r.tenant_id === TENANT_B)).toBe(true);
  });

  it("sewerage_connections: tenant B's raw unfiltered SELECT never returns tenant A's row", async () => {
    const applyRes = await app.inject({
      method: "POST", url: "/v1/sewerage/connections/apply", headers: hdr(TENANT_A, ["sewerage_user"]),
      payload: { connectionClass: "domestic" },
    });
    const applied = applyRes.json() as { id: string };
    await queue.drain();
    let current = (await app.inject({ method: "GET", url: `/v1/sewerage/connections/applications/${applied.id}`, headers: hdr(TENANT_A, ["sewerage_user"]) })).json().data;
    for (const next of ["feasibility_check", "estimate_issued", "payment_pending", "work_ordered"]) {
      await app.inject({
        method: "POST", url: `/v1/sewerage/connections/applications/${applied.id}/status`, headers: hdr(TENANT_A),
        payload: { status: next, version: current.version },
      });
      await queue.drain();
      current = (await app.inject({ method: "GET", url: `/v1/sewerage/connections/applications/${applied.id}`, headers: hdr(TENANT_A, ["sewerage_user"]) })).json().data;
    }
    await app.inject({
      method: "POST", url: `/v1/sewerage/connections/applications/${applied.id}/activate`, headers: hdr(TENANT_A),
      payload: { version: current.version },
    });
    await queue.drain();

    const rowsAsA = await rawSelectAsTenant("sewerage_connections", TENANT_A);
    expect(rowsAsA.length).toBeGreaterThan(0);

    const rowsAsB = await rawSelectAsTenant("sewerage_connections", TENANT_B);
    expect(rowsAsB.every((r) => r.tenant_id === TENANT_B)).toBe(true);
    expect(rowsAsB.some((r) => rowsAsA.some((a) => a.id === r.id))).toBe(false);
  });

  it("sewerage_bills: tenant B's raw unfiltered SELECT never returns tenant A's row", async () => {
    // Build a real, active connection for tenant A first (billing's own
    // pre-accept check requires one).
    const applyRes = await app.inject({
      method: "POST", url: "/v1/sewerage/connections/apply", headers: hdr(TENANT_A, ["sewerage_user"]),
      payload: { connectionClass: "domestic" },
    });
    const applied = applyRes.json() as { id: string };
    await queue.drain();
    let current = (await app.inject({ method: "GET", url: `/v1/sewerage/connections/applications/${applied.id}`, headers: hdr(TENANT_A, ["sewerage_user"]) })).json().data;
    for (const next of ["feasibility_check", "estimate_issued", "payment_pending", "work_ordered"]) {
      await app.inject({
        method: "POST", url: `/v1/sewerage/connections/applications/${applied.id}/status`, headers: hdr(TENANT_A),
        payload: { status: next, version: current.version },
      });
      await queue.drain();
      current = (await app.inject({ method: "GET", url: `/v1/sewerage/connections/applications/${applied.id}`, headers: hdr(TENANT_A, ["sewerage_user"]) })).json().data;
    }
    await app.inject({
      method: "POST", url: `/v1/sewerage/connections/applications/${applied.id}/activate`, headers: hdr(TENANT_A),
      payload: { version: current.version },
    });
    await queue.drain();
    const [connRow] = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT_A}, true)`;
      return tx`SELECT id FROM civitas_sewerage.sewerage_connections WHERE application_id = ${applied.id}`;
    });

    const genRes = await app.inject({
      method: "POST", url: "/v1/sewerage/bills", headers: hdr(TENANT_A),
      payload: { connectionId: connRow.id, billingPeriod: "2026-08", amountMinor: 4200, dueDate: "2026-09-30" },
    });
    expect(genRes.statusCode).toBe(202);
    const { id: billId } = genRes.json() as { id: string };
    await queue.drain();

    const rowsAsA = await rawSelectAsTenant("sewerage_bills", TENANT_A);
    expect(rowsAsA.some((r) => r.id === billId)).toBe(true);

    const rowsAsB = await rawSelectAsTenant("sewerage_bills", TENANT_B);
    expect(rowsAsB.some((r) => r.id === billId)).toBe(false);
    expect(rowsAsB.every((r) => r.tenant_id === TENANT_B)).toBe(true);
  });
});
