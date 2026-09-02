import { eq, and, desc, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsCandidates, hrmsCandidateOtpChallenges, type OtpChallengeRow } from "./candidate-schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

function affected(res: unknown): number {
  const r = res as { rowCount?: number; count?: number };
  return r.rowCount ?? r.count ?? 0;
}

export async function insertChallenge(tx: Writer, row: typeof hrmsCandidateOtpChallenges.$inferInsert): Promise<void> {
  await tx.insert(hrmsCandidateOtpChallenges).values(row);
}

/** The latest challenge for a candidate+channel (may be expired/verified). */
export async function findLatestChallenge(tenantId: string, candidateId: string, channel: string): Promise<OtpChallengeRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsCandidateOtpChallenges)
    .where(and(
      eq(hrmsCandidateOtpChallenges.tenantId, tenantId),
      eq(hrmsCandidateOtpChallenges.candidateId, candidateId),
      eq(hrmsCandidateOtpChallenges.channel, channel),
    ))
    .orderBy(desc(hrmsCandidateOtpChallenges.createdAt)).limit(1));
  return rows[0] ?? null;
}

/**
 * The latest challenge for a candidate+channel, LOCKED for the duration of
 * the caller's transaction (`SELECT ... FOR UPDATE`).
 *
 * SECURITY: pairs with `incrementAttempts` below to close a brute-force
 * race on the OTP lockout gate. Before this, the verify routes read
 * `attempts` via a plain (non-locking) read, checked it against
 * MAX_ATTEMPTS, and — only on a wrong code — incremented the counter via a
 * DEFERRED async publish. Concurrent verify requests against the SAME
 * challenge could each read the pre-increment count and be admitted past
 * the gate before an earlier failure's increment had landed (the async
 * publish could lag arbitrarily under queue load). Acquiring the row lock
 * HERE, before the MAX_ATTEMPTS check, forces concurrent requests against
 * the same challenge to serialize: the 2nd waits for the 1st's transaction
 * to commit (or roll back) before its own SELECT ... FOR UPDATE returns, so
 * it always observes the 1st's already-committed attempts count. See
 * `identity-service/modules/breakglass/repo.ts`'s `findByIdForUpdate` for
 * the established pattern this mirrors.
 *
 * CORRECTNESS: used by BOTH otp-verify routes (the HR-authenticated one
 * always did; the public careers-portal route was switched onto this
 * function from a since-removed `lockOldestChallenge` — see that function's
 * removal note in git history / this PR's description for why "oldest
 * pending" was a real, user-facing bug on the public route: otp-request
 * never invalidates/expires a candidate's prior challenge row when a new
 * OTP is issued (it just inserts a new one), so a candidate who requests a
 * second code (e.g. "resend") ends up with TWO non-expired, unverified,
 * under-MAX_ATTEMPTS rows. Picking the oldest of those matched the STALE
 * code the candidate no longer has, so their fresh code failed with a
 * spurious `OTP_INVALID` and burned an attempt. Picking the latest — same
 * as the HR route already did — matches the code that was actually
 * delivered.
 */
export async function lockLatestChallenge(tx: Writer, tenantId: string, candidateId: string, channel: string): Promise<OtpChallengeRow | null> {
  const rows = await tx.select().from(hrmsCandidateOtpChallenges)
    .where(and(
      eq(hrmsCandidateOtpChallenges.tenantId, tenantId),
      eq(hrmsCandidateOtpChallenges.candidateId, candidateId),
      eq(hrmsCandidateOtpChallenges.channel, channel),
    ))
    .orderBy(desc(hrmsCandidateOtpChallenges.createdAt))
    .limit(1)
    .for("update");
  return rows[0] ?? null;
}

/**
 * Atomically increment `attempts` by 1 and return the new count. A single
 * `UPDATE ... SET attempts = attempts + 1` is atomic under Postgres's
 * row-level locking regardless of caller — but callers on the failure path
 * of otp-verify should invoke this from WITHIN the same transaction that
 * already holds the row's `FOR UPDATE` lock (via `lockLatestChallenge`
 * above), so the MAX_ATTEMPTS gate and the increment that feeds it can
 * never observe two different snapshots of the row.
 *
 * Previously this read `attempts` via a separate SELECT and wrote back
 * `select + 1`, which was itself a non-atomic read-then-write — safe only
 * because every call site happened to already hold a lock or run
 * single-threaded. Replaced with a single atomic statement so correctness
 * no longer depends on that assumption.
 */
export async function incrementAttempts(tx: Writer, tenantId: string, id: string): Promise<number> {
  const updated = await tx.update(hrmsCandidateOtpChallenges)
    .set({ attempts: sql`${hrmsCandidateOtpChallenges.attempts} + 1` })
    .where(and(eq(hrmsCandidateOtpChallenges.tenantId, tenantId), eq(hrmsCandidateOtpChallenges.id, id)))
    .returning({ attempts: hrmsCandidateOtpChallenges.attempts });
  return updated[0]?.attempts ?? 0;
}

/**
 * Mark as verified + update candidate.emailVerified/mobileVerified.
 *
 * SECURITY/CORRECTNESS: on the otp-verify success path, both otp-verify
 * routes now call this SYNCHRONOUSLY, from WITHIN the same transaction that
 * already holds the challenge row's `FOR UPDATE` lock (acquired via
 * `lockLatestChallenge` above) — the same lock/transaction PR #906
 * introduced for the failure-path `incrementAttempts` race, extended to
 * also cover this write. Before this, `verified` was flipped via a
 * DEFERRED async publish (queue-processed), so two concurrent otp-verify
 * requests submitting the SAME correct code against the SAME
 * not-yet-verified challenge could each pass `verifyOtp` (which only
 * rejects an already-`verified` challenge) and each independently issue a
 * token — a double-token-issuance race, not a security bypass (both
 * submitters had the correct code), but an unintended double-issuance a
 * caller could reasonably expect to be impossible for a single-use code.
 * Writing `verified = true` here, before the lock is released, closes the
 * window: Postgres serializes the two transactions on the row lock, so the
 * second submitter's `lockLatestChallenge` blocks until the first commits,
 * then observes `verified = true` and `verifyOtp` rejects it with
 * `already_verified` — a normal 422, not a second success.
 */
export async function markVerified(tx: Writer, tenantId: string, id: string, candidateId: string, channel: string): Promise<void> {
  await tx.update(hrmsCandidateOtpChallenges).set({ verified: true })
    .where(and(eq(hrmsCandidateOtpChallenges.tenantId, tenantId), eq(hrmsCandidateOtpChallenges.id, id)));
  const patch: Record<string, unknown> = channel === "email" ? { emailVerified: true } : { mobileVerified: true };
  await tx.update(hrmsCandidates).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(hrmsCandidates.tenantId, tenantId), eq(hrmsCandidates.id, candidateId)));
}
