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
 * FINDING (see the "schema drift" test at the bottom): `loyalty.redemptions`
 * has a `member_id uuid NOT NULL` column with no default that the Drizzle table
 * definition in `src/modules/redemptions/schema.ts` does not model at all, so
 * `redemptionRepo.insert()` — and therefore POST /v1/loyalty/redeem — fails
 * against a real database with a NOT NULL violation. Fixing that needs a change
 * under `src/` or `migrations/`, which is out of scope for this change, so the
 * defect is reproduced and pinned here instead of being hidden.
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

/**
 * Insert a redemption row. This has to go through raw SQL rather than
 * `redemptionRepo.insert()` because that repo's Drizzle table omits the
 * NOT NULL `member_id` column — see the schema-drift test at the bottom of this
 * file. Everything downstream (void, balance restore, optimistic lock) is still
 * exercised through the real repo functions.
 */
async function seedRedemption(
  t: ScopedTx,
  args: { id: string; member: Member; points: bigint; rewardType: string },
): Promise<void> {
  await t.execute(sql`
    INSERT INTO loyalty.redemptions
      (id, tenant_id, member_id, enrolment_id, points, reward_type, status, created_by, updated_by, version)
    VALUES (
      ${args.id}::uuid, ${TENANT}::uuid, ${args.member.profileId}::uuid, ${args.member.enrolmentId}::uuid,
      ${args.points.toString()}::bigint, ${args.rewardType}, 'fulfilled', ${ACTOR}::uuid, ${ACTOR}::uuid, 1
    )
  `);
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
        await seedRedemption(t, { id: redemptionId, member, points, rewardType: "voucher" });
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
          await seedRedemption(t, { id: redemptionId, member, points, rewardType: "voucher" });
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
        await seedRedemption(t, { id: redemptionId, member, points, rewardType: "cashback" });
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

  it("FINDING: redemptionRepo.insert() cannot write a row — Drizzle schema omits NOT NULL member_id", async () => {
    // `loyalty.redemptions.member_id` is `uuid NOT NULL` with no default
    // (migrations/0001_redemptions.sql), but `redemptions` in
    // src/modules/redemptions/schema.ts has no `memberId` column. So the INSERT
    // that POST /v1/loyalty/redeem issues omits it and Postgres rejects the row.
    // The mock-based suite could never see this because the db was faked.
    // This assertion pins the defect; when the schema/migration is fixed this
    // test will start failing and must be replaced with a positive assertion.
    const member = await enrolMember();

    await expect(
      asTenant(TENANT, () =>
        tx((t) =>
          redemptionRepo.insert(t, {
            id: randomUUID(),
            tenantId: TENANT,
            enrolmentId: member.enrolmentId,
            points: BigInt(10),
            rewardType: "voucher",
            status: "fulfilled",
            createdBy: ACTOR,
            updatedBy: ACTOR,
          }),
        ),
      ),
    ).rejects.toThrow(/member_id/);
  });

  it("FINDING: redemptionRepo.voidRedemption() writes a status the DB CHECK forbids", async () => {
    // `loyalty_redemptions_status_check` allows only
    // ('pending','fulfilled','cancelled','expired'), but voidRedemption() sets
    // status = 'voided'. migrations/0002 added the voided_at / void_reason
    // columns without widening the CHECK, so POST
    // /v1/loyalty/redemptions/:id/void always fails against a real database.
    // Pinned here; replace with a positive assertion once the constraint or the
    // repo's status value is fixed.
    const member = await enrolMember();
    const redemptionId = randomUUID();
    const points = BigInt(25);

    await asTenant(TENANT, () =>
      tx((t) => seedRedemption(t, { id: redemptionId, member, points, rewardType: "voucher" })),
    );

    await expect(
      asTenant(TENANT, () =>
        tx((t) => redemptionRepo.voidRedemption(t, redemptionId, TENANT, "reason", ACTOR, 1)),
      ),
    ).rejects.toThrow(/loyalty_redemptions_status_check/);

    const still = await asTenant(TENANT, () => redemptionRepo.findById(redemptionId, TENANT));
    expect(still?.status).toBe("fulfilled");
  });
});
