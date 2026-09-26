/**
 * Payroll run-creation concurrency race — deterministic regression test
 * against a REAL Postgres (not mocked; see hrms-service's
 * screening-decision-race.test.ts and finance-service's
 * period-close-post-journal-race.test.ts for the same real-DB
 * concurrency-proof pattern elsewhere in this codebase).
 *
 * BACKGROUND: POST /v1/payroll/runs' synchronous pre-check (commands.ts's
 * createRun) used to be a bare, unlocked `SELECT ... LIMIT 1`. Two genuinely
 * concurrent requests for the same tenant+month+DDO both passed it before
 * either had written anything, so BOTH got 202 Accepted with two different
 * run ids — proven live via a real `Promise.all` burst against a running
 * instance (see the PR description for the full repro). The real conflict
 * only ever surfaced later, invisibly, inside the async consumer's own
 * advisory-lock guard (consumer.ts's "round2 fix"), by which point the HTTP
 * response had already gone out to both callers. A THIRD, sequential attempt
 * (made after a row already existed) always got a clean 409 — only true
 * concurrency slipped through.
 *
 * THE FIX makes the check-and-write synchronous and atomic: commands.ts's
 * createRun now takes the same transaction-scoped advisory lock
 * consumer.ts's handler used to take alone, and does the duplicate check AND
 * the row insert (+ audit event) itself, directly, before ever publishing
 * anything — so the loser's HTTP response reflects the real outcome
 * immediately, not a later, invisible one.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import { db, sqlClient } from "../src/shared/db.js";
import { payrollRuns, payrollStructures } from "../src/modules/payroll/schema.js";
import { buildApp } from "../src/app.js";
import * as commands from "../src/modules/payroll/commands.js";
import { HttpError } from "../src/shared/context.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OFFICER = randomUUID();
const ADMIN = randomUUID();
// commands.ts's createRun now rejects any structureId that doesn't name a
// real, active row in payroll.payroll_structures (see that function's
// STRUCTURE_NOT_FOUND check) -- every test below used to pass a bare
// randomUUID() here, which sailed through before that check existed but is
// now rejected with a 400 before this suite's own lock/duplicate logic ever
// runs. Mirrors the identical fix already applied to rls-isolation.test.ts,
// payroll-status-check-negative-net.test.ts and
// perf-021-sitea-payroll-nplus1.test.ts: seed one real, active structure
// once (below) and reuse its id everywhere this file used to mint a fresh,
// nonexistent one.
const STRUCT = randomUUID();

const auth = (sub: string, roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-race" }, SECRET)}`,
});

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function runsFor(month: string, ddoCode: string) {
  return runWithTenant(TENANT, () => db.transaction((tx) => tx.select().from(payrollRuns)
    .where(and(eq(payrollRuns.tenantId, TENANT), eq(payrollRuns.month, month), eq(payrollRuns.ddoCode, ddoCode)))));
}

beforeAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    // Delete-then-insert keeps this idempotent across repeated runs against
    // a persistent (non-wiped) test database (same convention as
    // rls-isolation.test.ts's beforeAll).
    await tx.delete(payrollStructures).where(eq(payrollStructures.id, STRUCT));
    await tx.insert(payrollStructures).values({
      id: STRUCT, tenantId: TENANT, name: "Race Test Structure",
      isDefault: true, status: "active", createdBy: OFFICER, updatedBy: OFFICER,
    });
  }));
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(payrollRuns).where(eq(payrollRuns.tenantId, TENANT));
    await tx.delete(payrollStructures).where(eq(payrollStructures.id, STRUCT));
  }));
  await sqlClient.end();
});

describe("POST /v1/payroll/runs — regular-run duplicate guard under TRUE concurrency (real Postgres)", () => {
  it("two genuinely concurrent requests for the same tenant+month+DDO: exactly one 202, one clean 409 — immediately, not after an async step", async () => {
    const month = "2031-07";
    const ddoCode = "DDO-RACE-1";
    const structureId = STRUCT;
    const app = await buildApp();

    // Fired back-to-back with no await between them -- both requests' own
    // duplicate checks happen before either write lands, exactly the proven
    // bug's precondition (genuine Promise.all, not sequential).
    const r1 = app.inject({
      method: "POST", url: "/v1/payroll/runs", headers: auth(OFFICER, ["payroll_admin"]),
      payload: { runNo: "RUN-RACE-A", month, ddoCode, structureId, runType: "regular" },
    });
    const r2 = app.inject({
      method: "POST", url: "/v1/payroll/runs", headers: auth(ADMIN, ["payroll_admin"]),
      payload: { runNo: "RUN-RACE-B", month, ddoCode, structureId, runType: "regular" },
    });
    const [res1, res2] = await Promise.all([r1, r2]);

    const statuses = [res1.statusCode, res2.statusCode].sort((a, b) => a - b);
    expect(statuses).toEqual([202, 409]);

    const winner = res1.statusCode === 202 ? res1 : res2;
    const loser = res1.statusCode === 409 ? res1 : res2;
    expect(winner.json()).toMatchObject({ status: "accepted" });
    expect(loser.json().code).toBe("DUPLICATE_RUN_FOR_PERIOD");

    // Exactly one row was ever created for this tenant+month+DDO -- never
    // both, never neither. Its id matches the winner's id (the loser's
    // attempted id was never persisted).
    const rows = await runsFor(month, ddoCode);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe((winner.json() as { id: string }).id);
    expect(rows[0]?.status).toBe("processing");

    await app.close();
  });

  it("control: a THIRD, sequential attempt after a row already exists still gets an immediate 409 (the pre-fix guard's one working case, unregressed)", async () => {
    const month = "2031-07";
    const ddoCode = "DDO-RACE-2";
    const structureId = STRUCT;
    const app = await buildApp();

    const first = await app.inject({
      method: "POST", url: "/v1/payroll/runs", headers: auth(OFFICER, ["payroll_admin"]),
      payload: { runNo: "RUN-SEQ-A", month, ddoCode, structureId, runType: "regular" },
    });
    expect(first.statusCode).toBe(202);

    const second = await app.inject({
      method: "POST", url: "/v1/payroll/runs", headers: auth(ADMIN, ["payroll_admin"]),
      payload: { runNo: "RUN-SEQ-B", month, ddoCode, structureId, runType: "regular" },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("DUPLICATE_RUN_FOR_PERIOD");

    const rows = await runsFor(month, ddoCode);
    expect(rows).toHaveLength(1);

    await app.close();
  });

  it("control: normal (non-concurrent) run creation is unaffected -- 202, then immediately visible via GET", async () => {
    const month = "2031-07";
    const ddoCode = "DDO-RACE-3";
    const structureId = STRUCT;
    const app = await buildApp();

    const created = await app.inject({
      method: "POST", url: "/v1/payroll/runs", headers: auth(OFFICER, ["payroll_admin"]),
      payload: { runNo: "RUN-NORMAL", month, ddoCode, structureId, runType: "regular" },
    });
    expect(created.statusCode).toBe(202);
    const { id } = created.json() as { id: string };

    const fetched = await app.inject({
      method: "GET", url: `/v1/payroll/runs/${id}`, headers: auth(OFFICER, ["payroll_admin"]),
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json()).toMatchObject({ id, payPeriod: month });

    await app.close();
  });

  it("the advisory lock genuinely serializes two createRun calls even with ZERO real timing overlap (deterministic, not schedule-dependent)", async () => {
    const month = "2031-09";
    const ddoCode = "DDO-RACE-GATE";
    const structureId = STRUCT;

    const parked = deferred<void>();
    const release = deferred<void>();
    const firstRunId = randomUUID();

    // Stands in for the WINNING request: takes the exact same advisory lock
    // createRun takes, inserts the row exactly as createRun's own
    // transaction would, then stays open (parked) so a second, genuinely
    // concurrent createRun call is GUARANTEED to still be waiting on the
    // lock when we check -- not just "usually" waiting because of
    // scheduling luck (same technique as finance-service's
    // period-close-post-journal-race.test.ts).
    const winnerTx = runWithTenant(TENANT, () => db.transaction(async (tx) => {
      const key = `payroll_run:${TENANT}:${month}:${ddoCode}:regular`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
      await tx.insert(payrollRuns).values({
        id: firstRunId, tenantId: TENANT, runNo: "RUN-GATE-1", month, ddoCode,
        structureId, runType: "regular", status: "processing", createdBy: ADMIN, updatedBy: ADMIN,
      });
      parked.resolve();
      await release.promise;
    }));

    await parked.promise; // the lock is now definitely held by winnerTx

    const ctx: RequestContext = {
      tenantId: TENANT, actorId: OFFICER, actorType: "user",
      roles: ["payroll_admin"], correlationId: randomUUID(),
    };
    let secondSettled = false;
    const secondCall = runWithTenant(TENANT, () => commands.createRun(ctx, {
      runNo: "RUN-GATE-2", month, ddoCode, structureId, runType: "regular",
    })).then(
      (v) => { secondSettled = true; return v; },
      (e) => { secondSettled = true; throw e; },
    );

    await wait(300); // generous one-directional margin, same as period-close's OVERLAP_MARGIN_MS
    expect(secondSettled).toBe(false); // still genuinely blocked on the lock, not racing ahead

    release.resolve();
    await winnerTx;

    let caught: unknown;
    try {
      await secondCall;
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(409);
    expect((caught as HttpError).code).toBe("DUPLICATE_RUN_FOR_PERIOD");

    const rows = await runsFor(month, ddoCode);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(firstRunId);
  });
});
