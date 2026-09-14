/**
 * REL-033 -- committee_vote_unique must include tenant_id, matching the
 * tenant-scoped uniqueness pattern already used elsewhere in this codebase
 * (e.g. working_calendar_code_unique UNIQUE (tenant_id, code), or
 * definitions_tenant_code_version_key -- see migrations 0028 and 0005).
 *
 * Found while building REL-032's own duplicate-check regression test
 * (rel-032-cast-vote-tenant-filter.test.ts): REL-032 fixed castVoteTx's
 * QUERIES to filter on tenantId, but committee_vote_unique -- the DB
 * CONSTRAINT enforcing one-vote-per-voter -- was still UNIQUE (decision_id,
 * voter_id) with no tenant_id. A poisoned committee_votes row belonging to a
 * DIFFERENT tenant at the same (decision_id, voter_id) -- constructible only
 * via a direct DB write that bypasses castVoteTx (a bug elsewhere, a
 * migration issue; decision_id is 1:1 with a single tenant through every
 * legitimate application code path) -- made a genuine, first-time voter's
 * legitimate INSERT collide with it, throwing a raw, unhandled PostgresError
 * (23505 unique_violation) instead of succeeding.
 *
 * Unlike REL-032's read-side gap, this is NOT mitigated by Row Level
 * Security. committee_votes carries a FORCE RLS tenant_isolation_policy
 * (migration 0028), so a NOBYPASSRLS role genuinely cannot SELECT a row
 * belonging to another tenant -- but Postgres enforces unique constraints
 * against the underlying physical index unconditionally, regardless of
 * whether the colliding row is visible to the inserting role. Verified below
 * (not assumed): the real `workflow_svc` login role, under RLS, with zero
 * visibility into the poisoned row, still hits the exact same unique-
 * violation on INSERT that a superuser connection would. This is why the
 * main proof below (`castVote succeeds...`) deliberately uses the ordinary
 * `db`/`runWithTenant` path -- the same one production traffic uses -- with
 * NO superuser bypass: unlike rel-032-cast-vote-tenant-filter.test.ts (which
 * needs a superuser connection specifically to stop RLS from masking a
 * regression in castVoteTx's own query text), there is no equivalent masking
 * risk here to guard against, because RLS was never providing any
 * protection against this particular failure mode in the first place.
 *
 * Fix: migrations/0043_committee_vote_unique_tenant_scoped.sql widens
 * committee_vote_unique to UNIQUE (tenant_id, decision_id, voter_id) -- a
 * pure widening (every existing row already satisfies it), so a poisoned
 * cross-tenant row no longer collides with a different tenant's genuine row
 * at all, while the real invariant (one vote per voter per decision WITHIN a
 * tenant) remains fully enforced.
 *
 * Sabotage-checked (see PR description): reverting migrations/0043 (via
 * `git diff` + `git apply`, not `git stash` -- refs/stash is shared across
 * every worktree on this host) and re-running this file, unmodified,
 * reproduces the raw `duplicate key value violates unique constraint
 * "committee_vote_unique"` PostgresError in both the constraint-level and
 * castVote end-to-end tests below; restoring the migration reproduces the
 * green results again.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { castVote } from "../src/modules/quorum/repo.js";
import { committeeDecisions, committeeVotes } from "../src/modules/quorum/schema.js";

const WORKFLOW_DB = "civitas_workflow";
const PGHOST = process.env["PGHOST"] ?? "localhost";
const PGPORT = process.env["PGPORT"] ?? "5435";
const PGUSER = process.env["PGUSER"] ?? "civitas";
const PGPASSWORD = process.env["PGPASSWORD"] ?? "civitas_test";
const SUPERUSER_DSN = `postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${WORKFLOW_DB}`;

/** Cheap connectivity probe, used only to decide skip vs run -- same convention as
 * this directory's other rel-032/rel-033 test files. */
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

// FLAKY-SKIP: Requires a real, reachable Postgres (probed at startup) for the REL-033 tenant-scoped UNIQUE constraint check; not provisioned in standard CI. (expires: 2026-12-13)
describe.skipIf(!reachable)(
  "REL-033 -- committee_vote_unique is tenant-scoped: UNIQUE (tenant_id, decision_id, voter_id)",
  () => {
    // Superuser connection used ONLY for direct constraint-level row counts
    // and cross-tenant cleanup (afterAll must delete rows across BOTH
    // tenants regardless of RLS) -- never for the main end-to-end proof
    // below, which deliberately goes through the ordinary db/runWithTenant
    // path with no bypass at all (see header).
    const superuserSql = postgres(SUPERUSER_DSN, { max: 1, onnotice: () => {} });

    const TENANT_A = randomUUID();
    const TENANT_B = randomUUID();
    const ACTOR = randomUUID();
    const seededDecisionIds: string[] = [];

    async function seedDecision(id: string, tenantId: string): Promise<void> {
      seededDecisionIds.push(id);
      await runWithTenant(tenantId, async () => {
        await db.transaction(async (tx) => {
          await tx.insert(committeeDecisions).values({
            id, tenantId, subject: "REL-033 tenant-scoped-constraint proof",
            rule: "majority", totalMembers: 5, status: "open", createdBy: ACTOR,
          });
        });
      });
    }

    /** Direct insert, bypassing castVoteTx entirely -- same construction as
     * REL-032's seedPoisonedVote, used here to probe committee_vote_unique
     * in isolation from castVoteTx's own duplicate-check logic. */
    async function insertVote(decisionId: string, tenantId: string, voterId: string): Promise<void> {
      await runWithTenant(tenantId, async () => {
        await db.transaction(async (tx) => {
          await tx.insert(committeeVotes).values({ tenantId, decisionId, voterId, vote: "approve", reason: null });
        });
      });
    }

    afterAll(async () => {
      for (const id of seededDecisionIds) {
        await superuserSql`DELETE FROM workflow.committee_votes WHERE decision_id = ${id}`;
        await superuserSql`DELETE FROM workflow.committee_decisions WHERE id = ${id}`;
      }
      await superuserSql.end({ timeout: 1 }).catch(() => undefined);
    });

    it("permits the SAME (decision_id, voter_id) pair under two DIFFERENT tenants -- the cross-tenant collision is now cleanly impossible, not just handled", async () => {
      const decisionId = randomUUID();
      const voterId = randomUUID();
      await seedDecision(decisionId, TENANT_A);
      // Same shape as REL-032's "poisoned row" (same decision_id, same
      // voter_id, different tenant_id) -- inserted directly here, twice,
      // purely to probe the constraint in isolation from castVoteTx. Must
      // NOT throw.
      await insertVote(decisionId, TENANT_A, voterId);
      await insertVote(decisionId, TENANT_B, voterId);

      const rows = await superuserSql`SELECT tenant_id FROM workflow.committee_votes WHERE decision_id = ${decisionId} ORDER BY tenant_id`;
      expect(rows.length).toBe(2);
    });

    it("still rejects a GENUINE duplicate within the SAME tenant -- the real one-vote-per-voter invariant is not weakened by widening the constraint", async () => {
      const decisionId = randomUUID();
      const voterId = randomUUID();
      await seedDecision(decisionId, TENANT_A);
      await insertVote(decisionId, TENANT_A, voterId);
      await expect(insertVote(decisionId, TENANT_A, voterId)).rejects.toThrow(/committee_vote_unique/);
    });

    it("castVote -- the real, production-shaped entry point, no superuser bypass -- succeeds cleanly for a genuine first-time voter despite a poisoned cross-tenant row at the same (decision_id, voter_id)", async () => {
      const decisionId = randomUUID();
      const voterX = randomUUID();
      await seedDecision(decisionId, TENANT_A);
      // Poisoned row: legitimately written AS TENANT_B (passes RLS's own
      // WITH CHECK), but decisionId points at a decision that actually
      // belongs to TENANT_A -- same construction as REL-032's regression
      // test. Nothing prevents this at the DB layer today --
      // committee_votes.decision_id is a bare FK to committee_decisions.id
      // with no cross-table tenant-consistency check.
      await insertVote(decisionId, TENANT_B, voterX);

      // The real, exported castVote -- db.transaction + castVoteTx, the
      // exact path production traffic uses -- via the ordinary
      // RLS-respecting workflow_svc connection (DATABASE_URL), inside
      // runWithTenant like any real caller. No superuser connection
      // anywhere in this test.
      const result = await runWithTenant(TENANT_A, () =>
        castVote(TENANT_A, decisionId, voterX, "approve", null, ACTOR, randomUUID()));
      if ("notFound" in result) throw new Error("decision unexpectedly not found");
      expect(result.duplicate).toBe(false);
      expect(result.tally.approvals).toBe(1);
      expect(result.tally.cast).toBe(1);
    });

    it("the real workflow_svc role cannot SELECT the poisoned row at all under RLS -- proving the test above is not accidentally relying on any RLS-provided protection", async () => {
      const decisionId = randomUUID();
      const voterId = randomUUID();
      await seedDecision(decisionId, TENANT_A);
      await insertVote(decisionId, TENANT_B, voterId);

      const visible = await runWithTenant(TENANT_A, () =>
        db.transaction((tx) => tx.select().from(committeeVotes).where(eq(committeeVotes.decisionId, decisionId))));
      expect(visible.length).toBe(0);

      // Yet the row -- and the constraint -- still physically exists.
      const physical = await superuserSql`SELECT tenant_id FROM workflow.committee_votes WHERE decision_id = ${decisionId}`;
      expect(physical.length).toBe(1);
      expect(physical[0]?.["tenant_id"]).toBe(TENANT_B);
    });
  },
);
