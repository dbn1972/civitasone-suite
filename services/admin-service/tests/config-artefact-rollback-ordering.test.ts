/**
 * WC-010 — rollback ORDERING and REPEAT behaviour.
 *
 * config-artefacts-routes.test.ts already covers a single successful rollback
 * and each individual guard. What it does not cover is what happens once a
 * rollback has landed:
 *
 *   • repeating the same rollback — a rollback is NOT idempotent-by-replay, it
 *     is idempotent-by-refusal: the second call is 422 NOT_A_ROLLBACK because
 *     the target is no longer strictly earlier than the live version. The
 *     important property is that the refusal leaves no trace: no second
 *     config_promotions row, no bump of config_env_state.version.
 *   • chaining rollbacks backwards (3 → 2 → 1), which must work, and
 *   • rolling FORWARDS via the rollback route, which must not.
 *   • a stale `expectedVersion` after a rollback → 409, never a silent overwrite.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const { buildApp } = await import("../src/app.js");
const { sqlClient } = await import("../src/shared/db.js");

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT = "c0110000-0000-4000-8000-0000000000f1";
const MAKER = "c0111111-0000-4000-8000-0000000000f2";
const CHECKER = "c0112222-0000-4000-8000-0000000000f3";
const SET = "app.ordering";
const ENV = "staging";

function auth(actorId: string, roles: string[] = ["tenant_admin"]): { authorization: string } {
  return {
    authorization: `Bearer ${signToken({ sub: actorId, tid: TENANT, roles, sid: "sess-ord" }, SECRET, 3600)}`,
  };
}

function asTenant<T>(run: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return run(sql as typeof sqlClient);
  }) as Promise<T>;
}

async function wipe(): Promise<void> {
  await asTenant(async (sql) => {
    await sql`DELETE FROM config.config_env_state WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM config.config_promotions WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM config.config_artefacts WHERE tenant_id = ${TENANT}`;
  });
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); await wipe(); });
afterAll(async () => { await wipe(); await app.close(); await sqlClient.end(); });

interface EnvStateRow { artefact_version: number; version: number }
function envState(): Promise<EnvStateRow[]> {
  return asTenant((sql) => sql<EnvStateRow[]>`
    SELECT artefact_version, version FROM config.config_env_state
    WHERE tenant_id = ${TENANT} AND set_key = ${SET} AND environment = ${ENV}`);
}

function rollbackRows(): Promise<Array<{ artefact_version: number; note: string | null }>> {
  return asTenant((sql) => sql<Array<{ artefact_version: number; note: string | null }>>`
    SELECT artefact_version, note FROM config.config_promotions
    WHERE tenant_id = ${TENANT} AND set_key = ${SET} AND kind = 'rollback'
    ORDER BY created_at`);
}

async function rollback(toVersion: number, expectedVersion: number): Promise<{
  statusCode: number; code?: string; body: Record<string, unknown> | undefined;
}> {
  const res = await app.inject({
    method: "POST", url: `/v1/admin/config-artefacts/environments/${ENV}/rollback`,
    headers: auth(CHECKER, ["super_admin"]),
    payload: { setKey: SET, toVersion, expectedVersion },
  });
  const json = res.json() as { data?: Record<string, unknown>; error?: { code: string } };
  return {
    statusCode: res.statusCode,
    ...(json.error ? { code: json.error.code } : {}),
    body: json.data,
  };
}

/** Snapshot version N, request its promotion into ENV and have a second actor approve. */
async function promote(entries: Record<string, unknown>): Promise<number> {
  const snap = await app.inject({
    method: "POST", url: "/v1/admin/config-artefacts", headers: auth(MAKER),
    payload: { setKey: SET, entries },
  });
  expect(snap.statusCode).toBe(201);
  const artefactVersion = (snap.json() as { data: { artefactVersion: number } }).data.artefactVersion;

  const promo = await app.inject({
    method: "POST", url: "/v1/admin/config-artefacts/promotions", headers: auth(MAKER),
    payload: { setKey: SET, artefactVersion, targetEnv: ENV },
  });
  expect(promo.statusCode).toBe(201);
  const p = (promo.json() as { data: { id: string; version: number } }).data;

  const approved = await app.inject({
    method: "POST", url: `/v1/admin/config-artefacts/promotions/${p.id}/approve`, headers: auth(CHECKER),
    payload: { expectedVersion: p.version },
  });
  expect(approved.statusCode).toBe(200);
  return artefactVersion;
}

describe("WC-010 rollback ordering and repeat behaviour", () => {
  beforeAll(async () => {
    // Three approved promotions into the same environment: v1, v2, v3 live.
    expect(await promote({ tier: "one" })).toBe(1);
    expect(await promote({ tier: "two" })).toBe(2);
    expect(await promote({ tier: "three" })).toBe(3);
    expect((await envState())[0]?.artefact_version).toBe(3);
  });

  it("rolls back one step at a time, 3 → 2", async () => {
    const before = await envState();
    const res = await rollback(2, before[0]?.version ?? 1);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ fromVersion: 3, toVersion: 2 });
    expect((await envState())[0]?.artefact_version).toBe(2);
  });

  it("refuses a REPEAT of the rollback it just performed, and changes nothing", async () => {
    const before = await envState();
    const rollbacksBefore = await rollbackRows();

    const res = await rollback(2, before[0]?.version ?? 1);
    expect(res.statusCode).toBe(422);
    expect(res.code).toBe("NOT_A_ROLLBACK");

    // The refusal must be total: same live version, same lock counter, and no
    // extra rollback record. A guard that threw after writing would show here.
    const after = await envState();
    expect(after[0]?.artefact_version).toBe(before[0]?.artefact_version);
    expect(after[0]?.version).toBe(before[0]?.version);
    expect(await rollbackRows()).toHaveLength(rollbacksBefore.length);
  });

  it("409 VERSION_CONFLICT when replayed with the pre-rollback expectedVersion", async () => {
    const current = (await envState())[0]?.version ?? 2;
    const res = await rollback(1, current - 1);
    expect(res.statusCode).toBe(409);
    expect(res.code).toBe("VERSION_CONFLICT");
    expect((await envState())[0]?.artefact_version).toBe(2);
  });

  it("chains a second rollback backwards, 2 → 1", async () => {
    const before = await envState();
    const res = await rollback(1, before[0]?.version ?? 1);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ fromVersion: 2, toVersion: 1 });

    const after = await envState();
    expect(after[0]?.artefact_version).toBe(1);
    expect(after[0]?.version).toBe((before[0]?.version ?? 1) + 1);
  });

  it("records each rollback as its own audited promotion row, in order", async () => {
    const rows = await rollbackRows();
    expect(rows.map((r) => r.artefact_version)).toEqual([2, 1]);
    // The note names the version each rollback moved AWAY from, so the chain is
    // reconstructable from the promotion table alone.
    expect(rows[0]?.note).toBe("rollback from version 3");
    expect(rows[1]?.note).toBe("rollback from version 2");
  });

  it("refuses to roll FORWARDS to a version it previously rolled back from", async () => {
    const before = await envState();
    const res = await rollback(3, before[0]?.version ?? 1);
    expect(res.statusCode).toBe(422);
    expect(res.code).toBe("NOT_A_ROLLBACK");
    expect((await envState())[0]?.artefact_version).toBe(1);
  });

  it("a re-promotion is the supported way forward, and it works after rollbacks", async () => {
    const promo = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts/promotions", headers: auth(MAKER),
      payload: { setKey: SET, artefactVersion: 3, targetEnv: ENV },
    });
    expect(promo.statusCode).toBe(201);
    const p = (promo.json() as { data: { id: string; version: number } }).data;

    const approved = await app.inject({
      method: "POST", url: `/v1/admin/config-artefacts/promotions/${p.id}/approve`, headers: auth(CHECKER),
      payload: { expectedVersion: p.version },
    });
    expect(approved.statusCode).toBe(200);
    expect((await envState())[0]?.artefact_version).toBe(3);
  });
});
