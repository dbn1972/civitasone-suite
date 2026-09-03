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
const { queue } = await import("../src/shared/infra.js");
const { tenantScoped } = await import("../src/shared/tenant-queue.js");
const { registerF3_config_Consumers } = await import("../src/modules/config/artefact-f3-consumer.js");

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
beforeAll(async () => {
  // Every write route here (snapshot/promote/approve/rollback) was converted
  // to F3 async (202); the consumer that applies them only runs in
  // src/worker.ts in production, so register it here against the real queue
  // singleton buildApp() wires the routes through — same pattern as
  // tests/config-artefacts-routes.test.ts.
  registerF3_config_Consumers(tenantScoped(queue));
  await queue.start();
  app = await buildApp();
  await wipe();
});
afterAll(async () => { await wipe(); await app.close(); await queue.stop(); await sqlClient.end(); });

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

/**
 * 202 command-acknowledgement envelope only — config/artefact-routes.ts's
 * rollback endpoint has NO synchronous guards at all (unlike snapshot/
 * promote/approve, which at least echo an id): every call, valid or not,
 * returns a bare 202 and the real outcome (success, 422 NOT_A_ROLLBACK, 409
 * VERSION_CONFLICT) only exists inside the async consumer
 * (artefact-f3-apply.ts's apply_config_4), with no channel back to the HTTP
 * caller. Drains the write and returns the status code anyway (tests below
 * still assert it, documenting the gap), but callers must verify the REAL
 * outcome via envState()/rollbackRows(), not this return value's body.
 */
async function rollback(toVersion: number, expectedVersion: number): Promise<{ statusCode: number }> {
  const res = await app.inject({
    method: "POST", url: `/v1/admin/config-artefacts/environments/${ENV}/rollback`,
    headers: auth(CHECKER, ["super_admin"]),
    payload: { setKey: SET, toVersion, expectedVersion },
  });
  await (queue as any).drain?.();
  return { statusCode: res.statusCode };
}

/** Snapshot version N, request its promotion into ENV and have a second actor approve. */
async function promote(entries: Record<string, unknown>): Promise<number> {
  const snap = await app.inject({
    method: "POST", url: "/v1/admin/config-artefacts", headers: auth(MAKER),
    payload: { setKey: SET, entries },
  });
  expect(snap.statusCode).toBe(202);
  await (queue as any).drain?.();
  // config/artefact-f3-apply.ts's apply_config_0/1 never forward the
  // route-generated id into the DB insert — same class of bug already
  // documented in tests/config-artefacts-routes.test.ts's snapshot()/
  // requestPromotion() helpers (real, pre-existing, out of this batch's
  // scope). Look the real rows up by content instead of trusting the echo.
  const artefacts = await app.inject({
    method: "GET", url: `/v1/admin/config-artefacts?limit=200&setKey=${encodeURIComponent(SET)}`,
    headers: auth(MAKER),
  });
  const artefactRow = (artefacts.json() as { data: Array<{ artefactVersion: number }> }).data[0];
  if (!artefactRow) throw new Error(`snapshot for '${SET}' never landed`);
  const artefactVersion = artefactRow.artefactVersion;

  const promo = await app.inject({
    method: "POST", url: "/v1/admin/config-artefacts/promotions", headers: auth(MAKER),
    payload: { setKey: SET, artefactVersion, targetEnv: ENV },
  });
  expect(promo.statusCode).toBe(202);
  await (queue as any).drain?.();
  const pending = await app.inject({
    method: "GET", url: "/v1/admin/config-artefacts/promotions?limit=200&status=pending", headers: auth(MAKER),
  });
  const p = (pending.json() as { data: Array<{ id: string; setKey: string; artefactVersion: number; targetEnv: string; version: number }> })
    .data.find((r) => r.setKey === SET && r.artefactVersion === artefactVersion && r.targetEnv === ENV);
  if (!p) throw new Error(`promotion request for '${SET}' -> ${ENV} never landed`);

  const approved = await app.inject({
    method: "POST", url: `/v1/admin/config-artefacts/promotions/${p.id}/approve`, headers: auth(CHECKER),
    payload: { expectedVersion: p.version },
  });
  expect(approved.statusCode).toBe(202);
  await (queue as any).drain?.();
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
    expect(res.statusCode).toBe(202);
    expect((await envState())[0]?.artefact_version).toBe(2);
  });

  // GAP (not a stale-status-code issue, left unfixed): config-artefacts/
  // routes.ts' rollback endpoint has no synchronous pre-accept validation at
  // all (see the rollback() helper's doc comment above) — a repeat of a
  // just-performed rollback is accepted (202) here instead of the old
  // synchronous 422 NOT_A_ROLLBACK. Same gap class as
  // tests/config-artefacts-routes.test.ts's rollback-guard GAPs. The
  // no-trace-left property IS still real (verified below via direct DB
  // reads after draining), only the synchronous status/code is unobservable.
  it("refuses a REPEAT of the rollback it just performed, and changes nothing", async () => {
    const before = await envState();
    const rollbacksBefore = await rollbackRows();

    const res = await rollback(2, before[0]?.version ?? 1);
    expect(res.statusCode).toBe(422);

    // The refusal must be total: same live version, same lock counter, and no
    // extra rollback record. A guard that threw after writing would show here.
    const after = await envState();
    expect(after[0]?.artefact_version).toBe(before[0]?.artefact_version);
    expect(after[0]?.version).toBe(before[0]?.version);
    expect(await rollbackRows()).toHaveLength(rollbacksBefore.length);
  });

  // GAP (not a stale-status-code issue, left unfixed) — same as above.
  it("409 VERSION_CONFLICT when replayed with the pre-rollback expectedVersion", async () => {
    const current = (await envState())[0]?.version ?? 2;
    const res = await rollback(1, current - 1);
    expect(res.statusCode).toBe(409);
    expect((await envState())[0]?.artefact_version).toBe(2);
  });

  it("chains a second rollback backwards, 2 → 1", async () => {
    const before = await envState();
    const res = await rollback(1, before[0]?.version ?? 1);
    expect(res.statusCode).toBe(202);

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

  // GAP (not a stale-status-code issue, left unfixed) — same as above.
  it("refuses to roll FORWARDS to a version it previously rolled back from", async () => {
    const before = await envState();
    const res = await rollback(3, before[0]?.version ?? 1);
    expect(res.statusCode).toBe(422);
    expect((await envState())[0]?.artefact_version).toBe(1);
  });

  it("a re-promotion is the supported way forward, and it works after rollbacks", async () => {
    const promo = await app.inject({
      method: "POST", url: "/v1/admin/config-artefacts/promotions", headers: auth(MAKER),
      payload: { setKey: SET, artefactVersion: 3, targetEnv: ENV },
    });
    expect(promo.statusCode).toBe(202);
    await (queue as any).drain?.();
    const pending = await app.inject({
      method: "GET", url: "/v1/admin/config-artefacts/promotions?limit=200&status=pending", headers: auth(MAKER),
    });
    const p = (pending.json() as { data: Array<{ id: string; setKey: string; artefactVersion: number; targetEnv: string; version: number }> })
      .data.find((r) => r.setKey === SET && r.artefactVersion === 3 && r.targetEnv === ENV);
    if (!p) throw new Error(`re-promotion for '${SET}' -> ${ENV} never landed`);

    const approved = await app.inject({
      method: "POST", url: `/v1/admin/config-artefacts/promotions/${p.id}/approve`, headers: auth(CHECKER),
      payload: { expectedVersion: p.version },
    });
    expect(approved.statusCode).toBe(202);
    await (queue as any).drain?.();
    expect((await envState())[0]?.artefact_version).toBe(3);
  });
});
