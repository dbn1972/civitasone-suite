/**
 * Decision module — status/lineage integrity gaps.
 *
 * `handleDecisionUpdate` (src/modules/decision/consumer.ts:551-595) applies `patch.status` and
 * `patch.supersededById` to `meeting.decisions` completely verbatim (lines 578-579) — it never
 * queries `meeting.resolutions` to check the linked vote's actual outcome, never checks
 * `supersededById` refers to a real, same-tenant decision, and — critically — never calls the
 * cycle guard the codebase already has for exactly this purpose:
 * `assertAcyclicLineage`/`buildSupersedePlan`/`wouldCreateCycle` (decision/domain.ts:364-420) are
 * thoroughly property-tested in isolation (tests/decision-domain.property.test.ts:287-336) but
 * `grep -rln "buildSupersedePlan\|assertAcyclicLineage\|wouldCreateCycle" src/` matches only
 * `domain.ts` itself — never `consumer.ts`. The safety net exists and is unit-tested; it is
 * simply never wired into the write path. (The same "guard exists, never called" shape recurs
 * in `voting/domain.ts`'s `assertVotesWithinPresent`/`itemQuorumDenominator` and
 * `minutes/domain.ts`'s `verifyChain` — flagged in the sibling test files for those modules.)
 *
 * This file proves, against real Postgres:
 *   1. A decision's `status` can be PATCHed to `"effective"` even though its linked resolution's
 *      real, voting-module-computed `result` is `"rejected"` — nothing cross-checks it.
 *   2. `supersededById` can be set to a UUID that belongs to NO decision at all (dangling
 *      lineage pointer) — only format-validated, never existence-checked.
 *   3. A 3-node supersession cycle (A supersedes B, B supersedes C, C supersedes A) can be fully
 *      constructed — the acyclicity guard that exists in `domain.ts` never runs.
 *
 * `it.fails()` encodes the CORRECT behavior (repo precedent:
 * visitor-service/tests/badge-print-revoked-pass.test.ts) — flip to a plain `it()` once fixed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS } from "../src/topics.js";
import { registerDecisionConsumers } from "../src/modules/decision/consumer.js";

const TENANT = "a0b8b3e6-dec1-4000-8000-0000000000d9";
const COMMITTEE = "b0b8b3e6-dec1-4000-8000-0000000000d9";
const MEETING = "c0b8b3e6-dec1-4000-8000-0000000000d9";
const ACTOR = "e0b8b3e6-dec1-4000-8000-0000000000d9";

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
async function readDecision(id: string): Promise<any | null> {
  const rows = await tenantQuery((sql) => sql`select * from meeting.decisions where id = ${id}`);
  return rows[0] ?? null;
}

async function recordDecision(decisionId: string): Promise<void> {
  await run(
    msg(COMMANDS.decisionRecord, {
      decisionId,
      meetingId: MEETING,
      tenantId: TENANT,
      text: `Decision ${decisionId}`,
      type: "administrative",
    }),
  );
}
async function updateDecision(decisionId: string, version: number, patch: Record<string, unknown>): Promise<void> {
  await run(
    msg(COMMANDS.decisionUpdate, {
      meetingId: MEETING,
      tenantId: TENANT,
      decisionId,
      version,
      patch,
    }),
  );
}

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.resolutions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.decisions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;

    await sql`
      insert into meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
      values (${COMMITTEE}, ${TENANT}, 'Integrity Committee', 'IC', 'board', '2025-01-01', ${sql.json({ minMembers: 1 })}, ${ACTOR}, ${ACTOR})`;
    await sql`
      insert into meeting.meetings (id, tenant_id, type, title, status, committee_id, financial_year, scheduled_at, quorum_established, created_by, updated_by)
      values (${MEETING}, ${TENANT}, 'committee', 'Integrity meeting', 'in_progress', ${COMMITTEE}, '2025-26', '2025-06-01T09:00:00Z', true, ${ACTOR}, ${ACTOR})`;
  });
});

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.resolutions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.decisions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

describe("[BUG] decision.status can be set inconsistent with its linked resolution's real outcome", () => {
  it.fails("must not accept status='effective' on a decision whose linked resolution actually failed", async () => {
    const decisionId = randomUUID();
    await recordDecision(decisionId);

    const resolutionId = randomUUID();
    await tenantQuery(
      (sql) => sql`
        insert into meeting.resolutions
          (id, tenant_id, meeting_id, decision_id, resolution_number, text, vote_type, majority_rule,
           votes_for, votes_against, votes_abstain, result, status, is_circulation, created_by, updated_by)
        values (${resolutionId}, ${TENANT}, ${MEETING}, ${decisionId}, ${"RES-" + resolutionId}, 'The linked motion',
                'roll_call', 'simple_majority', 1, 4, 0, 'rejected', 'rejected', false, ${ACTOR}, ${ACTOR})`,
    );

    await updateDecision(decisionId, 1, { status: "effective" });

    const decision = await readDecision(decisionId);
    // Correct behavior: a decision cannot be "effective" while its own linked resolution result
    // is "rejected" — the two records would openly contradict each other in the official minutes.
    expect(decision.status).not.toBe("effective");
  });

  it("characterizes today's actual (buggy) behavior: the contradiction is accepted silently", async () => {
    const decisionId = randomUUID();
    await recordDecision(decisionId);
    const resolutionId = randomUUID();
    await tenantQuery(
      (sql) => sql`
        insert into meeting.resolutions
          (id, tenant_id, meeting_id, decision_id, resolution_number, text, vote_type, majority_rule,
           votes_for, votes_against, votes_abstain, result, status, is_circulation, created_by, updated_by)
        values (${resolutionId}, ${TENANT}, ${MEETING}, ${decisionId}, ${"RES-" + resolutionId}, 'The linked motion',
                'roll_call', 'simple_majority', 1, 4, 0, 'rejected', 'rejected', false, ${ACTOR}, ${ACTOR})`,
    );
    await updateDecision(decisionId, 1, { status: "effective" });

    const decision = await readDecision(decisionId);
    const resolution = (await tenantQuery((sql) => sql`select * from meeting.resolutions where id = ${resolutionId}`))[0];
    expect(decision.status).toBe("effective");
    expect(resolution.result).toBe("rejected"); // the two records now flatly contradict each other
  });
});

describe("[BUG] supersededById is never checked to reference a real decision", () => {
  it.fails("must not accept a supersededById that matches no decision at all", async () => {
    const decisionId = randomUUID();
    await recordDecision(decisionId);
    const ghost = randomUUID(); // no row in meeting.decisions anywhere

    await updateDecision(decisionId, 1, { status: "superseded", supersededById: ghost });

    const decision = await readDecision(decisionId);
    expect(decision.superseded_by_id).toBeNull();
  });

  it("characterizes today's actual (buggy) behavior: the dangling pointer is persisted", async () => {
    const decisionId = randomUUID();
    await recordDecision(decisionId);
    const ghost = randomUUID();
    await updateDecision(decisionId, 1, { status: "superseded", supersededById: ghost });

    const decision = await readDecision(decisionId);
    expect(decision.superseded_by_id).toBe(ghost);
  });
});

describe("[BUG] the acyclic-lineage guard (domain.ts) is never invoked by the write path", () => {
  it.fails("must not allow a 3-node supersession cycle to be completed", async () => {
    const A = randomUUID();
    const B = randomUUID();
    const C = randomUUID();
    await recordDecision(A);
    await recordDecision(B);
    await recordDecision(C);

    // A -> supersedes -> B
    await updateDecision(A, 1, { status: "superseded", supersededById: B });
    // B -> supersedes -> C
    await updateDecision(B, 1, { status: "superseded", supersededById: C });
    // C -> supersedes -> A: closes the cycle A -> B -> C -> A. This third update is exactly the
    // case `wouldCreateCycle`/`assertAcyclicLineage` (domain.ts:364-420) exists to reject.
    await expect(updateDecision(C, 1, { status: "superseded", supersededById: A })).rejects.toThrow();
  });

  it("characterizes today's actual (buggy) behavior: the 3-cycle is fully persisted with no error", async () => {
    const A = randomUUID();
    const B = randomUUID();
    const C = randomUUID();
    await recordDecision(A);
    await recordDecision(B);
    await recordDecision(C);

    await updateDecision(A, 1, { status: "superseded", supersededById: B });
    await updateDecision(B, 1, { status: "superseded", supersededById: C });
    await updateDecision(C, 1, { status: "superseded", supersededById: A }); // does not throw today

    const [a, b, c] = await Promise.all([readDecision(A), readDecision(B), readDecision(C)]);
    expect(a.superseded_by_id).toBe(B);
    expect(b.superseded_by_id).toBe(C);
    expect(c.superseded_by_id).toBe(A); // the register's lineage graph is now a closed cycle
  });
});
