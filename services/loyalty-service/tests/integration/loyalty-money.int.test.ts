/**
 * loyalty-money.int.test.ts — REAL PostgreSQL integration test.
 *
 * Every other loyalty test mocks `src/shared/db.js`, so none of this service's
 * SQL had ever executed. This file connects as the `loyalty_svc` login role
 * (never as the superuser — a superuser bypasses RLS, so admin-connected tests
 * prove nothing about isolation) and drives the ACTUAL repo functions.
 *
 * Focus: money correctness. Points are `bigint` paise-style counters, so the
 * highest-risk failure is a silent precision loss on the JS ⇄ Postgres boundary
 * above 2^53, plus the `points_balance >= 0` CHECK constraint that mocks can
 * never exercise.
 *
 * Also guards the two write paths that migration 0004 unblocked: the Drizzle
 * table now models the (nullable) `member_id` column so `redemptionRepo.insert()`
 * can write a row, and the status allowlist accepts `'voided'` so
 * `redemptionRepo.voidRedemption()` can complete.
 *
 * Skips (does not fail) when Postgres is unreachable so a machine without the
 * dev database still gets a green suite.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import type { ScopedTx } from "../../src/shared/db.js";

const EXPECTED_DB = "civitas_loyalty";
const DEFAULT_DSN = `postgres://loyalty_svc:loyalty_dev_pw@localhost:5435/${EXPECTED_DB}`;
// Only honour an inherited DSN when it actually addresses this service's
// database — a vitest config further up the tree can otherwise point
// DATABASE_URL at a different service's DB.
const inheritedDsn = process.env["DATABASE_URL"];
const DSN = inheritedDsn?.includes(EXPECTED_DB) === true ? inheritedDsn : DEFAULT_DSN;
// `src/shared/db.ts` builds its client at module-evaluation time from
// DATABASE_URL, so the value has to be in place BEFORE that module is imported.
// Hence the dynamic imports below — static imports would be hoisted above this.
process.env["DATABASE_URL"] = DSN;

/** Cheap connectivity probe on a throwaway client, used only to decide skip vs run. */
async function probe(): Promise<boolean> {
  const client = postgres(DSN, { max: 1, connect_timeout: 2, idle_timeout: 1, onnotice: () => {} });
  try {
    await client`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await client.end({ timeout: 1 }).catch(() => undefined);
  }
}

const reachable = await probe();

const { db, sqlClient } = await import("../../src/shared/db.js");
const { runWithTenant } = await import("@civitasone/db");
const programRepo = await import("../../src/modules/programs/repo.js");
const enrolmentRepo = await import("../../src/modules/enrolments/repo.js");
const accrualRepo = await import("../../src/modules/accruals/repo.js");
const redemptionRepo = await import("../../src/modules/redemptions/repo.js");
const { programs } = await import("../../src/modules/programs/schema.js");
const { enrolments } = await import("../../src/modules/enrolments/schema.js");
const { accruals } = await import("../../src/modules/accruals/schema.js");
const { redemptions } = await import("../../src/modules/redemptions/schema.js");

/** Unique per run so repeated runs never collide and cleanup is exact. */
const TENANT = randomUUID();
const ACTOR = randomUUID();
const PROGRAM_ID = randomUUID();

/** Every repo call goes through the tenant hook, which sets the app.tenant_id GUC. */
function asTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return Promise.resolve(runWithTenant(tenantId, fn));
}

function tx<T>(fn: (t: ScopedTx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}

interface Member {
  enrolmentId: string;
  profileId: string;
}

/** Enrol a fresh member through the real enrolments repo. */
async function enrolMember(): Promise<Member> {
  const enrolmentId = randomUUID();
  const profileId = randomUUID();
  await asTenant(TENANT, () =>
    tx((t) =>
      enrolmentRepo.insert(t, {
        id: enrolmentId,
        tenantId: TENANT,
        programId: PROGRAM_ID,
        profileId,
        status: "active",
        tier: "base",
        pointsBalance: BigInt(0),
        lifetimePoints: BigInt(0),
        createdBy: ACTOR,
        updatedBy: ACTOR,
      }),
    ),
  );
  return { enrolmentId, profileId };
}

/** Accrue `points` and move the balance, exactly as the accrual route does. */
async function accrue(enrolmentId: string, points: bigint): Promise<void> {
  const before = await asTenant(TENANT, () => enrolmentRepo.findById(enrolmentId, TENANT));
  expect(before).not.toBeNull();
  const version = before?.version ?? 1;

  await asTenant(TENANT, () =>
    tx(async (t) => {
      await accrualRepo.insert(t, {
        id: randomUUID(),
        tenantId: TENANT,
        enrolmentId,
        points,
        source: "integration-test",
        txType: "bonus",
        createdBy: ACTOR,
      });
      const ok = await enrolmentRepo.adjustBalance(t, enrolmentId, TENANT, points, points, version);
      expect(ok).toBe(true);
    }),
  );
}

async function balanceOf(enrolmentId: string): Promise<bigint> {
  const row = await asTenant(TENANT, () => enrolmentRepo.findById(enrolmentId, TENANT));
  if (!row) throw new Error(`enrolment ${enrolmentId} not found`);
  return row.pointsBalance;
}

describe.skipIf(!reachable)("loyalty repo — real Postgres (money correctness)", () => {
  beforeAll(async () => {
    await asTenant(TENANT, () =>
      tx((t) =>
        programRepo.insert(t, {
          id: PROGRAM_ID,
          tenantId: TENANT,
          name: `int-test-${PROGRAM_ID.slice(0, 8)}`,
          status: "active",
          earnRatio: BigInt(100),
          createdBy: ACTOR,
          updatedBy: ACTOR,
        }),
      ),
    );
  });

  afterAll(async () => {
    // Clean up only this run's rows, child tables first (FK order).
    await asTenant(TENANT, () =>
      tx(async (t) => {
        await t.delete(accruals).where(eq(accruals.tenantId, TENANT));
        await t.delete(redemptions).where(eq(redemptions.tenantId, TENANT));
        await t.delete(enrolments).where(eq(enrolments.tenantId, TENANT));
        await t.delete(programs).where(eq(programs.tenantId, TENANT));
      }),
    ).catch(() => undefined);
    await sqlClient.end({ timeout: 5 }).catch(() => undefined);
  });

  it("is connected to civitas_loyalty as the non-superuser service role", async () => {
    const rows = await asTenant(TENANT, () =>
      tx((t) =>
        t.execute<{ db: string; who: string; is_super: boolean }>(
          sql`SELECT current_database() AS db, current_user AS who,
                     (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_super`,
        ),
      ),
    );
    const row = Array.isArray(rows) ? rows[0] : undefined;
    expect(row?.db).toBe(EXPECTED_DB);
    expect(row?.who).toBe("loyalty_svc");
    // A superuser bypasses RLS, so these tests would not exercise it.
    expect(row?.is_super).toBe(false);
  });

  it("enrols a member and persists an accrued balance exactly", async () => {
    const { enrolmentId } = await enrolMember();
    expect(await balanceOf(enrolmentId)).toBe(BigInt(0));

    await accrue(enrolmentId, BigInt(2500));
    await accrue(enrolmentId, BigInt(175));

    const row = await asTenant(TENANT, () => enrolmentRepo.findById(enrolmentId, TENANT));
    expect(row?.pointsBalance).toBe(BigInt(2675));
    expect(row?.lifetimePoints).toBe(BigInt(2675));
    // version bumped once per adjustBalance, computed by the DB.
    expect(row?.version).toBe(3);

    const summary = await asTenant(TENANT, () => accrualRepo.getBalanceSummary(TENANT, enrolmentId));
    expect(summary.totalAccrued).toBe(BigInt(2675));
    expect(summary.activePoints).toBe(BigInt(2675));

    // The view serialises bigint as a string — no float anywhere on the wire.
    expect(row ? enrolmentRepo.toView(row).pointsBalance : "").toBe("2675");
  });

  it("survives a round-trip through Postgres bigint well above 2^53 with no precision loss", async () => {
    const { enrolmentId } = await enrolMember();
    // 2^53 + 1 — the first integer JS `number` cannot represent.
    const beyondFloat = BigInt("9007199254740993");
    expect(Number(beyondFloat)).toBe(9007199254740992); // proves the value is past 2^53

    await accrue(enrolmentId, beyondFloat);
    expect(await balanceOf(enrolmentId)).toBe(beyondFloat);

    // Accrue a second, much larger value and check the sum is still exact.
    const huge = BigInt("4611686018427387904"); // 2^62
    await accrue(enrolmentId, huge);

    const expected = beyondFloat + huge;
    const row = await asTenant(TENANT, () => enrolmentRepo.findById(enrolmentId, TENANT));
    expect(row?.pointsBalance).toBe(expected);
    expect(row?.lifetimePoints).toBe(expected);
    expect(row ? enrolmentRepo.toView(row).pointsBalance : "").toBe("4620693217682128897");

    // SUM() over the accruals table agrees to the digit.
    const summary = await asTenant(TENANT, () => accrualRepo.getBalanceSummary(TENANT, enrolmentId));
    expect(summary.totalAccrued).toBe(expected);
    // A float round-trip would have silently corrupted it.
    expect(BigInt(Number(expected))).not.toBe(expected);
  });

  it("redeems within balance and decrements it correctly", async () => {
    const member = await enrolMember();
    const { enrolmentId } = member;
    await accrue(enrolmentId, BigInt(1000));

    const enrolment = await asTenant(TENANT, () => enrolmentRepo.findById(enrolmentId, TENANT));
    expect(enrolment).not.toBeNull();
    const redemptionId = randomUUID();
    const points = BigInt(400);

    await asTenant(TENANT, () =>
      tx(async (t) => {
        await redemptionRepo.insert(t, {
          id: redemptionId,
          tenantId: TENANT,
          memberId: member.profileId,
          enrolmentId,
          points,
          rewardType: "voucher",
          status: "fulfilled",
          createdBy: ACTOR,
          updatedBy: ACTOR,
        });
        const ok = await enrolmentRepo.adjustBalance(
          t,
          enrolmentId,
          TENANT,
          -points,
          BigInt(0),
          enrolment?.version ?? 1,
        );
        expect(ok).toBe(true);
      }),
    );

    expect(await balanceOf(enrolmentId)).toBe(BigInt(600));
    const persisted = await asTenant(TENANT, () => redemptionRepo.findById(redemptionId, TENANT));
    expect(persisted?.points).toBe(points);
    expect(persisted?.status).toBe("fulfilled");
    expect(persisted?.memberId).toBe(member.profileId);
    expect(persisted ? redemptionRepo.toView(persisted).points : "").toBe("400");
    // Lifetime points are unaffected by a redemption.
    const row = await asTenant(TENANT, () => enrolmentRepo.findById(enrolmentId, TENANT));
    expect(row?.lifetimePoints).toBe(BigInt(1000));
  });

  it("rejects a redemption above the balance and rolls the whole transaction back", async () => {
    const member = await enrolMember();
    const { enrolmentId } = member;
    await accrue(enrolmentId, BigInt(500));

    const enrolment = await asTenant(TENANT, () => enrolmentRepo.findById(enrolmentId, TENANT));
    const redemptionId = randomUUID();
    const points = BigInt(501);

    await expect(
      asTenant(TENANT, () =>
        tx(async (t) => {
          await redemptionRepo.insert(t, {
            id: redemptionId,
            tenantId: TENANT,
            memberId: member.profileId,
            enrolmentId,
            points,
            rewardType: "voucher",
            status: "fulfilled",
            createdBy: ACTOR,
            updatedBy: ACTOR,
          });
          await enrolmentRepo.adjustBalance(t, enrolmentId, TENANT, -points, BigInt(0), enrolment?.version ?? 1);
        }),
      ),
    ).rejects.toThrow(/loyalty_enrolments_balance_non_negative/);

    // Balance untouched and the redemption row rolled back with the transaction.
    expect(await balanceOf(enrolmentId)).toBe(BigInt(500));
    expect(await asTenant(TENANT, () => redemptionRepo.findById(redemptionId, TENANT))).toBeNull();
  });

  it("restores the balance exactly when a redemption is reversed", async () => {
    const member = await enrolMember();
    const { enrolmentId } = member;
    await accrue(enrolmentId, BigInt(900));

    const redemptionId = randomUUID();
    const points = BigInt(250);
    const beforeRedeem = await asTenant(TENANT, () => enrolmentRepo.findById(enrolmentId, TENANT));

    await asTenant(TENANT, () =>
      tx(async (t) => {
        await redemptionRepo.insert(t, {
          id: redemptionId,
          tenantId: TENANT,
          memberId: member.profileId,
          enrolmentId,
          points,
          rewardType: "cashback",
          status: "fulfilled",
          createdBy: ACTOR,
          updatedBy: ACTOR,
        });
        await enrolmentRepo.adjustBalance(t, enrolmentId, TENANT, -points, BigInt(0), beforeRedeem?.version ?? 1);
      }),
    );
    expect(await balanceOf(enrolmentId)).toBe(BigInt(650));

    const afterRedeem = await asTenant(TENANT, () => enrolmentRepo.findById(enrolmentId, TENANT));

    // The balance half of the void flow: credit the points back.
    const restored = await asTenant(TENANT, () =>
      tx((t) =>
        enrolmentRepo.adjustBalance(t, enrolmentId, TENANT, points, BigInt(0), afterRedeem?.version ?? 1),
      ),
    );
    expect(restored).toBe(true);
    expect(await balanceOf(enrolmentId)).toBe(BigInt(900));

    // Replaying the same credit with the now-stale version is a no-op, so a
    // retried void cannot double-credit the member.
    const replayed = await asTenant(TENANT, () =>
      tx((t) =>
        enrolmentRepo.adjustBalance(t, enrolmentId, TENANT, points, BigInt(0), afterRedeem?.version ?? 1),
      ),
    );
    expect(replayed).toBe(false);
    expect(await balanceOf(enrolmentId)).toBe(BigInt(900));

    // voidRedemption's optimistic lock: a stale version matches no row, so it
    // reports false without touching the row.
    const staleVoid = await asTenant(TENANT, () =>
      tx((t) => redemptionRepo.voidRedemption(t, redemptionId, TENANT, "stale", ACTOR, 99)),
    );
    expect(staleVoid).toBe(false);
    const untouched = await asTenant(TENANT, () => redemptionRepo.findById(redemptionId, TENANT));
    expect(untouched?.status).toBe("fulfilled");
  });

  it("relies on the DB CHECK constraint to refuse a negative balance", async () => {
    const { enrolmentId } = await enrolMember();
    await accrue(enrolmentId, BigInt(100));

    const enrolment = await asTenant(TENANT, () => enrolmentRepo.findById(enrolmentId, TENANT));

    await expect(
      asTenant(TENANT, () =>
        tx((t) =>
          enrolmentRepo.adjustBalance(t, enrolmentId, TENANT, BigInt(-101), BigInt(0), enrolment?.version ?? 1),
        ),
      ),
    ).rejects.toThrow(/loyalty_enrolments_balance_non_negative/);

    expect(await balanceOf(enrolmentId)).toBe(BigInt(100));
  });

  it("persists a redemption through redemptionRepo.insert(), with and without a member_id", async () => {
    // `member_id` was NOT NULL with no default in 0001 while the Drizzle table
    // did not model the column at all, so every insert this repo issued was
    // rejected. 0004 relaxed the constraint and the column is now mapped, so
    // both the enrolment-only and the denormalised-member shapes must persist.
    const member = await enrolMember();

    const withMemberId = randomUUID();
    await asTenant(TENANT, () =>
      tx((t) =>
        redemptionRepo.insert(t, {
          id: withMemberId,
          tenantId: TENANT,
          memberId: member.profileId,
          enrolmentId: member.enrolmentId,
          points: BigInt(10),
          rewardType: "voucher",
          status: "fulfilled",
          createdBy: ACTOR,
          updatedBy: ACTOR,
        }),
      ),
    );

    const persisted = await asTenant(TENANT, () => redemptionRepo.findById(withMemberId, TENANT));
    expect(persisted).not.toBeNull();
    expect(persisted?.memberId).toBe(member.profileId);
    expect(persisted?.enrolmentId).toBe(member.enrolmentId);
    expect(persisted?.points).toBe(BigInt(10));
    expect(persisted?.status).toBe("fulfilled");
    expect(persisted?.version).toBe(1);
    // The view exposes memberId and keeps points a string on the wire.
    const view = persisted ? redemptionRepo.toView(persisted) : null;
    expect(view?.memberId).toBe(member.profileId);
    expect(view?.points).toBe("10");

    // Enrolment-only path: no profile id known, member_id stays null.
    const withoutMemberId = randomUUID();
    await asTenant(TENANT, () =>
      tx((t) =>
        redemptionRepo.insert(t, {
          id: withoutMemberId,
          tenantId: TENANT,
          enrolmentId: member.enrolmentId,
          points: BigInt(5),
          rewardType: "voucher",
          status: "fulfilled",
          createdBy: ACTOR,
          updatedBy: ACTOR,
        }),
      ),
    );
    const nullMember = await asTenant(TENANT, () => redemptionRepo.findById(withoutMemberId, TENANT));
    expect(nullMember).not.toBeNull();
    expect(nullMember?.memberId).toBeNull();
    expect(nullMember ? redemptionRepo.toView(nullMember).memberId : undefined).toBeNull();
  });

  it("voids a redemption end to end and keeps the optimistic lock honest", async () => {
    // voidRedemption() writes status = 'voided', which the 0001 allowlist
    // rejected until 0004 widened it.
    const member = await enrolMember();
    const redemptionId = randomUUID();
    const points = BigInt(25);

    await asTenant(TENANT, () =>
      tx((t) =>
        redemptionRepo.insert(t, {
          id: redemptionId,
          tenantId: TENANT,
          memberId: member.profileId,
          enrolmentId: member.enrolmentId,
          points,
          rewardType: "voucher",
          status: "fulfilled",
          createdBy: ACTOR,
          updatedBy: ACTOR,
        }),
      ),
    );

    const voided = await asTenant(TENANT, () =>
      tx((t) => redemptionRepo.voidRedemption(t, redemptionId, TENANT, "customer changed mind", ACTOR, 1)),
    );
    expect(voided).toBe(true);

    const row = await asTenant(TENANT, () => redemptionRepo.findById(redemptionId, TENANT));
    expect(row?.status).toBe("voided");
    expect(row?.voidReason).toBe("customer changed mind");
    expect(row?.voidedAt).toBeInstanceOf(Date);
    expect(row?.updatedBy).toBe(ACTOR);
    // version + 1 is computed by the DB, not by the application.
    expect(row?.version).toBe(2);
    // Points are untouched by a void — only the balance restore moves them.
    expect(row?.points).toBe(points);

    const view = row ? redemptionRepo.toView(row) : null;
    expect(view?.status).toBe("voided");
    expect(view?.voidedAt).toEqual(expect.any(String));

    // Replaying the void with the now-stale version matches no row, so a retry
    // cannot re-void (and, upstream, cannot double-credit the member).
    const replayed = await asTenant(TENANT, () =>
      tx((t) => redemptionRepo.voidRedemption(t, redemptionId, TENANT, "retry", ACTOR, 1)),
    );
    expect(replayed).toBe(false);
    const unchanged = await asTenant(TENANT, () => redemptionRepo.findById(redemptionId, TENANT));
    expect(unchanged?.voidReason).toBe("customer changed mind");
    expect(unchanged?.version).toBe(2);
  });
});
