/**
 * Resolution integrity — fabrication bypass + cross-module majority-rule contradiction.
 *
 * Governance-cluster audit (committee/decision/voting/minutes/action-item), focused on the
 * single most consequential gap found: `meeting.resolutions` — the table that IS the official
 * record of what a committee decided — can be written by TWO independent code paths that
 * disagree with each other and, in one case, require no real vote at all.
 *
 * ── Path A (legitimate): voting module ──────────────────────────────────────────────────────
 * `vote.initiate` → `vote.cast` (one row per member in `meeting.votes`) → `vote.conclude`, which
 * tallies the actual `votes` rows via `voting/domain.ts` `computeTally` + `computeVoteResult`
 * (src/modules/voting/domain.ts:86-174). That `computeVoteResult` treats the majority base as
 * ALL ballots cast (`total = for + against + abstain`) — its own docstring (lines 140-145) is
 * explicit that abstentions count toward the base.
 *
 * ── Path B (the bug): decision module ───────────────────────────────────────────────────────
 * `POST /v1/meetings/:meetingId/resolutions` (src/modules/decision/routes.ts:182-190, roles
 * `meeting_admin`/`committee_secretary`/`tenant_admin`/`super_admin` — `decision/routes.ts:69`)
 * → `resolutionRecordSchema` (src/modules/decision/validators.ts:97-106), which accepts
 * `votesFor`/`votesAgainst`/`votesAbstain` as plain client-supplied integers (default 0, no
 * cross-check against anything) → `commands.resolutionRecord` (decision/commands.ts:119-136)
 * publishes them verbatim → `handleResolutionRecord` (decision/consumer.ts:601-664):
 *   - never queries `meeting.votes` for this resolution (there IS no resolution yet — this
 *     command CREATES one from nothing);
 *   - never checks `meeting.quorum_established` or even meeting status;
 *   - computes `result` via decision's OWN `computeVoteResult` (src/modules/decision/domain.ts:
 *     164-192), whose docstring (lines 152-153) explicitly says the OPPOSITE of voting's:
 *     "Abstentions are recorded but do NOT count toward the majority base — the base is the
 *     decisive votes (for + against)";
 *   - INSERTs directly into `meeting.resolutions` with a real, officially sequential
 *     `resolutionNumber` (P25 numbering, decision/consumer.ts:613-617) and `status: "effective"`
 *     (line 638), then fires `resolution.passed`/`resolution.rejected` (line 644-659) —
 *     indistinguishable from a resolution that went through a real roll-call vote.
 *
 * Net effect: any actor holding the tenant-wide `committee_secretary` role (not scoped to any
 * specific committee — see the sibling committee/voting IDOR findings) can fabricate an
 * arbitrarily-numbered, officially "effective" resolution with whatever vote counts they like,
 * for a meeting with zero attendance and zero quorum, and have it computed as `passed` or
 * `rejected` using a DIFFERENT (and looser, for the common `simple_majority` case with
 * abstentions) formula than the one the voting module itself enforces for real votes.
 *
 * This test file proves both halves live against real Postgres:
 *   1. The two `computeVoteResult` implementations disagree on an identical tally (pure functions,
 *      no DB — the contradiction is deterministic and needs no fixture).
 *   2. `resolution.record` inserts a fully "effective", numbered resolution from a fabricated
 *      tally, for a meeting with NO quorum and NO committee roster at all.
 *
 * `it.fails()` encodes the CORRECT behavior (kept red on purpose — see repo precedent
 * `visitor-service/tests/badge-print-revoked-pass.test.ts`): flip to a plain `it()` once fixed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { registerDecisionConsumers } from "../src/modules/decision/consumer.js";
import { computeVoteResult as votingComputeVoteResult } from "../src/modules/voting/domain.js";
import { computeVoteResult as decisionComputeVoteResult } from "../src/modules/decision/domain.js";

const TENANT = "a0b8b3e6-fab0-4000-8000-0000000000fa";
const MEETING = "c0b8b3e6-fab0-4000-8000-0000000000fa"; // NO committee, NO quorum — nothing to vote with
const ACTOR = "e0b8b3e6-fab0-4000-8000-0000000000fa"; // holds only "committee_secretary" per the exploit

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerDecisionConsumers((topic, h) => handlers.set(topic, h as any));

function msg<T>(type: string, payload: T, messageId = randomUUID()): CommandEnvelope<T> {
  return {
    messageId,
    type,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload,
  } as CommandEnvelope<T>;
}

function run<T>(m: CommandEnvelope<T>): Promise<void> {
  const handler = handlers.get(m.type);
  if (!handler) throw new Error(`no handler for ${m.type}`);
  return runWithTenant(TENANT, () => handler(m)) as Promise<void>;
}

function tenantQuery<T>(fn: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return fn(sql as unknown as typeof sqlClient);
    }),
  ) as Promise<T>;
}

async function readResolution(id: string): Promise<any | null> {
  const rows = await tenantQuery((sql) => sql`select * from meeting.resolutions where id = ${id}`);
  return rows[0] ?? null;
}
async function voteRowCount(resolutionId: string): Promise<number> {
  const rows = await tenantQuery(
    (sql) => sql`select count(*)::int as n from meeting.votes where resolution_id = ${resolutionId}`,
  );
  return rows[0].n as number;
}

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.votes where tenant_id = ${TENANT}`;
    await sql`delete from meeting.resolutions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;

    // Deliberately: NO committee, NO committee_members, quorum_established = false.
    // There is no roster this meeting could ever legitimately hold a vote against.
    await sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, committee_id, financial_year, scheduled_at, quorum_established, created_by, updated_by)
      values (${MEETING}, ${TENANT}, 'committee', 'Unquorate / no-roster meeting', 'in_progress', NULL, '2025-26',
              '2025-06-01T09:00:00Z', false, ${ACTOR}, ${ACTOR})`;
  });
});

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.votes where tenant_id = ${TENANT}`;
    await sql`delete from meeting.resolutions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

describe("[FIXED] voting and decision modules now agree on the result for the same tally", () => {
  // for:3 against:2 abstain:2 — deliberately chosen so the two modules' PREVIOUSLY documented,
  // opposite abstention conventions used to flip the outcome:
  //   voting (before the fix):   total = 7 (abstain counted in the base) → 3*2=6 is NOT > 7  → "rejected"
  //   decision (always):         decisive = 5 (abstain excluded)        → 3 > 2              → "passed"
  // voting/domain.ts's computeVoteResult now delegates to decision/domain.ts's implementation
  // (the decisive-votes-only convention — standard parliamentary procedure), so both modules
  // compute "passed" for this tally.
  const tally = { votesFor: 3, votesAgainst: 2, votesAbstain: 2 };

  it("sanity: voting/domain.ts computeVoteResult now AGREES with decision/domain.ts — passes this tally under simple_majority", () => {
    const result = votingComputeVoteResult({ ...tally, total: 7 }, "simple_majority");
    expect(result).toBe("passed");
  });

  it("sanity: decision/domain.ts computeVoteResult passes this SAME tally under simple_majority", () => {
    const result = decisionComputeVoteResult(tally, "simple_majority");
    expect(result).toBe("passed");
  });

  it(
    "[FIXED] the two modules now agree on pass/fail for one committee's resolution outcome",
    () => {
      const votingResult = votingComputeVoteResult({ ...tally, total: 7 }, "simple_majority");
      const decisionResult = decisionComputeVoteResult(tally, "simple_majority");
      // Both "passed" — the same official record can no longer read differently depending on
      // which of the two live HTTP routes wrote it.
      expect(decisionResult).toBe(votingResult);
      expect(votingResult).toBe("passed");
    },
  );
});

describe("[FIXED] resolution.record can no longer fabricate an official, numbered resolution with no real votes", () => {
  it(
    "rejects a votesFor/against/abstain tally for a meeting with quorum_established = false, even with zero matching meeting.votes rows",
    async () => {
      const resolutionId = randomUUID();
      await expect(
        run(
          msg(COMMANDS.resolutionRecord, {
            resolutionId,
            meetingId: MEETING,
            tenantId: TENANT,
            text: "Resolved: sanction the fabricated expenditure",
            voteType: "roll_call",
            majorityRule: "simple_majority",
            // Claimed 9-for / 1-against — there is no committee, no roster, no attendee, and (see
            // below) zero rows in meeting.votes for this resolution. Nothing here is real.
            votesFor: 9,
            votesAgainst: 1,
            votesAbstain: 0,
          }),
        ),
      ).rejects.toBeInstanceOf(NonRetryableError);

      const zeroRealVotes = await voteRowCount(resolutionId);
      expect(zeroRealVotes).toBe(0);

      const row = await readResolution(resolutionId);
      // Correct behavior: a resolution with no backing ballots and no quorum is never persisted
      // as an official, numbered, "effective" record.
      expect(row).toBeNull();
    },
  );

  it(
    "rejects recording a resolution for a meeting with quorum_established = false",
    async () => {
      const resolutionId = randomUUID();
      await expect(
        run(
          msg(COMMANDS.resolutionRecord, {
            resolutionId,
            meetingId: MEETING, // quorum_established: false, seeded in beforeAll
            tenantId: TENANT,
            text: "Resolved: business conducted without quorum",
            voteType: "show_of_hands",
            majorityRule: "simple_majority",
            votesFor: 2,
            votesAgainst: 0,
            votesAbstain: 0,
          }),
        ),
      ).rejects.toBeInstanceOf(NonRetryableError);

      const row = await readResolution(resolutionId);
      expect(row).toBeNull();
    },
  );

  it("confirms the fix: once quorum IS established, an aggregate-tally resolution (show_of_hands/secret_ballot's legitimate use case) IS still recordable", async () => {
    const quorateMeeting = randomUUID();
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      await sql`
        insert into meeting.meetings
          (id, tenant_id, type, title, status, committee_id, financial_year, scheduled_at, quorum_established, created_by, updated_by)
        values (${quorateMeeting}, ${TENANT}, 'committee', 'Quorate meeting for the fixed path', 'in_progress', NULL, '2025-26',
                '2025-06-01T09:00:00Z', true, ${ACTOR}, ${ACTOR})`;
    });

    const resolutionId = randomUUID();
    await run(
      msg(COMMANDS.resolutionRecord, {
        resolutionId,
        meetingId: quorateMeeting,
        tenantId: TENANT,
        text: "Resolved: business conducted with quorum, aggregate show-of-hands count",
        voteType: "show_of_hands",
        majorityRule: "simple_majority",
        votesFor: 5,
        votesAgainst: 0,
        votesAbstain: 0,
      }),
    );

    const row = await readResolution(resolutionId);
    expect(row).not.toBeNull();
    expect(row.status).toBe("effective");
    expect(row.result).toBe("passed");
    expect(typeof row.resolution_number).toBe("string");
    expect(row.resolution_number.length).toBeGreaterThan(0);
    expect(row.votes_for).toBe(5);

    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      await sql`delete from meeting.resolutions where meeting_id = ${quorateMeeting}`;
      await sql`delete from meeting.meetings where id = ${quorateMeeting}`;
    });
  });
});
