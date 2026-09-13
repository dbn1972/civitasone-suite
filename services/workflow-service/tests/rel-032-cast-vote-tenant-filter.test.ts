/**
 * REL-032 -- castVoteTx's three internal queries must filter identically on
 * both decisionId AND tenantId (this gap's own DoD), matching
 * listVotes/findDecisionWithVotes (its siblings in repo.ts), which already
 * did.
 *
 * Deliberately does NOT use the normal `workflow_svc` app connection
 * (NOBYPASSRLS): committee_votes carries a FORCE ROW LEVEL SECURITY
 * tenant_isolation_policy (migration 0028_workflow_engine_100.sql), and
 * Postgres RLS transparently filters every row by tenant_id for ANY
 * NOBYPASSRLS role regardless of the query's own WHERE clause -- so a test
 * run through that connection would pass identically whether or not
 * castVoteTx's own filters are correct, masking exactly the regression this
 * file exists to catch. (That masking effect is not hypothetical -- see
 * rel-032-tenant-filter-rls.test.ts, which independently proves it's real
 * and load-bearing today.)
 *
 * Instead this file opens its own connection as the `civitas` bootstrap
 * superuser (PGHOST/PGPORT/PGUSER/PGPASSWORD env, the same convention
 * .github/workflows/*.yml already uses in plaintext) and passes it as
 * castVoteTx's own `tx` argument directly. PostgreSQL superusers always
 * bypass RLS by Postgres's own design, independent of any role attribute
 * (this is verified below, not assumed) -- so with this connection, ONLY
 * castVoteTx's own WHERE clauses determine what is visible/matched. No new
 * role is created; nothing here is committed to any migration.
 *
 * Each scenario seeds a "poisoned" committee_votes row: a row that
 * legitimately belongs to TENANT_B (inserted through the normal,
 * RLS-respecting app `db` connection while TENANT_B's own GUC is set, so
 * the insert itself proves nothing irregular) but whose decision_id points
 * at a real decision that actually belongs to TENANT_A. Nothing prevents
 * this at the DB layer today -- committee_votes.decision_id is a bare FK to
 * committee_decisions.id with no cross-table tenant-consistency check -- so
 * this models exactly the kind of stray row defense-in-depth is for (a bug
 * or migration elsewhere that lets a mis-tenanted row exist), not a
 * contrived test-only state.
 *
 * The two vulnerable queries each get their OWN decision + poisoned row,
 * chosen so `committee_vote_unique` -- UNIQUE (decision_id, voter_id),
 * notably NOT including tenant_id (a separate, out-of-scope finding; see
 * this gap's PR description) -- never conflates the two scenarios:
 *
 *  - recompute-tally scenario: the poisoned row uses a DIFFERENT voter_id
 *    than the genuine vote, so castVoteTx's own INSERT never collides with
 *    it -- isolating a clean approvals-count comparison.
 *  - duplicate-check scenario: the poisoned row deliberately uses the SAME
 *    voter_id, reproducing the exact collision the missing filter used to
 *    mask. Because (decision_id, voter_id) is globally unique regardless of
 *    tenant, the FIXED query correctly refusing to treat that poisoned row
 *    as TENANT_A's own prior vote means castVoteTx proceeds to an INSERT
 *    that the constraint then rejects -- so the fixed code's observable
 *    behavior here is a thrown unique-violation, versus the unfixed code's
 *    clean-but-wrong `duplicate: true` return with no error at all. Both
 *    are unambiguous, sabotage-differentiating signals; a thrown constraint
 *    error in this specific scenario (constructible only via a direct DB
 *    write that bypasses castVoteTx entirely, as this test's own seeding
 *    does -- never through normal application operation) is not itself a
 *    production concern.
 *
 * Sabotage-checked (see PR description): reverting repo.ts's two tenantId
 * predicates and re-running this file, unmodified, flips the recompute-tally
 * scenario's `approvals` to 2 and makes the duplicate-check scenario resolve
 * cleanly with `duplicate: true` instead of throwing; restoring the fix
 * reproduces both results below again. The final test (castVoteTx's FIRST
 * query, the decision lock) is untouched by REL-032 and expected to pass
 * either way -- it already filtered on tenantId before this fix.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { castVoteTx, type Writer } from "../src/modules/quorum/repo.js";
import { committeeDecisions, committeeVotes, schema } from "../src/modules/quorum/schema.js";

const WORKFLOW_DB = "civitas_workflow";
const PGHOST = process.env["PGHOST"] ?? "localhost";
const PGPORT = process.env["PGPORT"] ?? "5435";
const PGUSER = process.env["PGUSER"] ?? "civitas";
const PGPASSWORD = process.env["PGPASSWORD"] ?? "civitas_test";
const SUPERUSER_DSN = `postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${WORKFLOW_DB}`;

async function probe(): Promise<boolean> {
  const client = postgres(SUPERUSER_DSN, { max: 1, connect_timeout: 2, idle_timeout: 1, onnotice: () => {} });
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

describe.skipIf(!reachable)(
  "REL-032 -- castVoteTx's own queries filter on tenantId, independent of RLS (superuser connection, RLS provably inert)",
  () => {
    const superuserSql = postgres(SUPERUSER_DSN, { max: 1, onnotice: () => {} });
    const superuserDb = drizzle(superuserSql, { schema });

    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const ACTOR = randomUUID();
    const seededDecisionIds: string[] = [];

    /** totalMembers=5, majority: 1 approval never exceeds half (2.5), so
     * castVoteTx never reaches its decided/enqueue() branch in this file --
     * keeps every scenario's footprint to committee_decisions/committee_votes
     * only. */
    async function seedDecision(id: string, tenantId: string): Promise<void> {
      seededDecisionIds.push(id);
      await runWithTenant(tenantId, async () => {
        await db.transaction(async (tx) => {
          await tx.insert(committeeDecisions).values({
            id, tenantId, subject: "REL-032 tenant-filter proof",
            rule: "majority", totalMembers: 5, status: "open", createdBy: ACTOR,
          });
        });
      });
    }

    /** Legitimately written AS `tenantId` (passes RLS's own WITH CHECK), but
     * `decisionId` points at a decision actually owned by a different
     * tenant -- see this file's header for why that's possible today. */
    async function seedPoisonedVote(decisionId: string, tenantId: string, voterId: string): Promise<void> {
      await runWithTenant(tenantId, async () => {
        await db.transaction(async (tx) => {
          await tx.insert(committeeVotes).values({ tenantId, decisionId, voterId, vote: "approve", reason: null });
        });
      });
    }

    beforeAll(async () => {
      // Confirm RLS really is inert on this connection before trusting the
      // rest of this file -- if this ever returns false, `civitas` stopped
      // being a real superuser (or FORCE RLS changed elsewhere), and every
      // assertion below would be meaningless rather than merely passing.
      const su = await superuserSql`SELECT usesuper FROM pg_user WHERE usename = current_user`;
      expect(su[0]?.["usesuper"]).toBe(true);
    });

    afterAll(async () => {
      for (const id of seededDecisionIds) {
        await superuserSql`DELETE FROM workflow.committee_votes WHERE decision_id = ${id}`;
        await superuserSql`DELETE FROM workflow.committee_decisions WHERE id = ${id}`;
      }
      await superuserSql.end({ timeout: 1 }).catch(() => undefined);
    });

    it("recompute-tally query excludes a poisoned cross-tenant row -- counts only the genuine TENANT_A vote", async () => {
      const decisionId = randomUUID();
      const voterPoison = randomUUID();
      const voterReal = randomUUID();
      await seedDecision(decisionId, TENANT_A);
      await seedPoisonedVote(decisionId, TENANT_B, voterPoison);

      const result = await superuserDb.transaction((tx) =>
        castVoteTx(tx as unknown as Writer, TENANT_A, decisionId, voterReal, "approve", null, ACTOR, randomUUID()));
      if ("notFound" in result) throw new Error("decision unexpectedly not found");
      expect(result.duplicate).toBe(false);
      // The core DoD assertion: NOT 2. Pre-fix this counted the poisoned
      // TENANT_B row too.
      expect(result.tally.approvals).toBe(1);
      expect(result.tally.cast).toBe(1);

      // Both rows really do physically exist -- proves the assertion above
      // is castVoteTx's own filter at work, not the poisoning insert having
      // silently failed.
      const rows = await superuserSql`SELECT tenant_id FROM workflow.committee_votes WHERE decision_id = ${decisionId}`;
      expect(rows.length).toBe(2);
    });

    it("duplicate-check query does not mistake a poisoned cross-tenant row for TENANT_A's own prior vote", async () => {
      const decisionId = randomUUID();
      const voterX = randomUUID();
      await seedDecision(decisionId, TENANT_A);
      // Poisoned row at the SAME voter_id this test then votes with -- the
      // exact collision the missing tenantId filter used to mask.
      await seedPoisonedVote(decisionId, TENANT_B, voterX);

      // See this file's header: committee_vote_unique has no tenant_id, so
      // this (decisionId, voterX) pair can only ever be occupied once --
      // here, already taken by the poisoned TENANT_B row above. The FIXED
      // duplicate-check query correctly does NOT recognize that row as
      // TENANT_A's own (right decisionId, right voter_id, WRONG tenant_id),
      // so it does not short-circuit with `duplicate: true` -- it proceeds
      // to the real INSERT, which the constraint then rejects. That thrown
      // violation is the proof the fix works: the unfixed query would have
      // matched the poisoned row and returned CLEANLY with the wrong
      // `duplicate: true`, never reaching the INSERT (and never throwing)
      // at all.
      await expect(
        superuserDb.transaction((tx) =>
          castVoteTx(tx as unknown as Writer, TENANT_A, decisionId, voterX, "approve", null, ACTOR, randomUUID())),
      ).rejects.toThrow(/committee_vote_unique/);
    });

    it("castVoteTx's FIRST query (the decision lock) remains correctly tenant-scoped -- TENANT_B cannot vote against TENANT_A's decisionId (unchanged by this fix, already correct)", async () => {
      const decisionId = randomUUID();
      await seedDecision(decisionId, TENANT_A);
      const result = await superuserDb.transaction((tx) =>
        castVoteTx(tx as unknown as Writer, TENANT_B, decisionId, randomUUID(), "approve", null, ACTOR, randomUUID()));
      expect(result).toEqual({ notFound: true });
    });
  },
);
