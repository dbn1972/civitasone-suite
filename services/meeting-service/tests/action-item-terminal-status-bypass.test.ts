/**
 * Action-item module — terminal-status bypass + verifier-identity forgery.
 *
 * `SETTLED_STATUSES = ["completed", "verified", "withdrawn"]` (action-item/domain.ts:59) is
 * meant to be terminal — `idx_actions_deadline` (migrations/0001_meeting_core.sql:709-710) is
 * even a partial index keyed on `status NOT IN ('completed','verified','withdrawn')`, i.e. the
 * schema itself assumes settled items drop out of "what's outstanding" views. But the mutating
 * handlers in `action-item/consumer.ts` never check `row.status` before writing:
 *
 *   - `handleEvidence` (consumer.ts:471-520) unconditionally sets `status: "evidence_submitted"`
 *     (line 487) with NO read of `row.status` first — callable on an already-`"completed"` item,
 *     silently un-completing it.
 *   - `handleVerify` verified=true (consumer.ts:536-557) never checks
 *     `row.status === "evidence_submitted"` before setting `status: "completed"` (line 551) and
 *     overwriting `verifiedBy`/`verifiedAt`/`completedAt` (549-552) — re-verifying an
 *     already-completed item silently replaces the ORIGINAL verifier's audit trail with a new
 *     one and re-fires `action_item.completed` (558-565).
 *   - `handleVerify` verified=false (567-582) unconditionally sets `status: "in_progress"` with
 *     no status check either — can reopen a `"withdrawn"` (cancelled) item.
 *   - `verifierId` (action-item/validators.ts:114-119, `actionItemVerifySchema`) is a plain
 *     client-supplied UUID, forwarded to `verifiedBy` (consumer.ts:549) with NO check that it
 *     differs from `row.assigneeId` or matches `msg.actorId` — the same actor who assigned
 *     themselves the item and submitted their own evidence can "verify" it and additionally name
 *     an ARBITRARY `verifierId` (e.g. the real secretary's UUID), forging who signed off. In
 *     formal committee governance this independence is the entire point of a verify step.
 *
 * This mirrors the exact bug class flagged in the visitor-service audit ("a revoked pass still
 * checks in at the gate") — a settled/terminal status that a later handler forgets to check.
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
import { registerActionItemConsumers } from "../src/modules/action-item/consumer.js";

const TENANT = "a0b8b3e6-a171-4000-8000-0000000000a1";
const COMMITTEE = "b0b8b3e6-a171-4000-8000-0000000000a1";
const MEETING = "c0b8b3e6-a171-4000-8000-0000000000a1";
const ASSIGNEE = "d0b8b3e6-a171-4000-8000-00000000a501";
const REAL_SECRETARY = "d0b8b3e6-a171-4000-8000-00000000a502"; // a genuine, independent verifier
const ACTOR = "e0b8b3e6-a171-4000-8000-0000000000a1";

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerActionItemConsumers((topic, h) => handlers.set(topic, h as any));

function msg<T>(type: string, payload: T, actorId = ACTOR, messageId = randomUUID()): CommandEnvelope<T> {
  return {
    messageId,
    type,
    tenantId: TENANT,
    actorId,
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
async function readItem(id: string): Promise<any | null> {
  const rows = await tenantQuery((sql) => sql`select * from meeting.action_items where id = ${id}`);
  return rows[0] ?? null;
}

/** Seed an action item already 'completed' — the terminal state the bugs below try to escape. */
async function seedCompletedItem(id: string, verifiedBy = REAL_SECRETARY): Promise<void> {
  await tenantQuery(
    (sql) => sql`
      insert into meeting.action_items
        (id, tenant_id, meeting_id, description, assignee_id, deadline, priority, escalation_level,
         status, evidence_url, verified_by, verified_at, completed_at, created_by, updated_by)
      values (${id}, ${TENANT}, ${MEETING}, 'Submit the compliance report', ${ASSIGNEE}, '2025-06-10T00:00:00Z',
              'medium', 0, 'completed', 'https://files.example/report.pdf', ${verifiedBy}, now(), now(), ${ACTOR}, ${ACTOR})`,
  );
}
/** Seed an item mid-flow with evidence submitted, awaiting verification. */
async function seedEvidenceSubmittedItem(id: string): Promise<void> {
  await tenantQuery(
    (sql) => sql`
      insert into meeting.action_items
        (id, tenant_id, meeting_id, description, assignee_id, deadline, priority, escalation_level,
         status, evidence_url, created_by, updated_by)
      values (${id}, ${TENANT}, ${MEETING}, 'Submit the compliance report', ${ASSIGNEE}, '2025-06-10T00:00:00Z',
              'medium', 0, 'evidence_submitted', 'https://files.example/report.pdf', ${ACTOR}, ${ACTOR})`,
  );
}
/** Seed a withdrawn (cancelled) item. */
async function seedWithdrawnItem(id: string): Promise<void> {
  await tenantQuery(
    (sql) => sql`
      insert into meeting.action_items
        (id, tenant_id, meeting_id, description, assignee_id, deadline, priority, escalation_level, status, created_by, updated_by)
      values (${id}, ${TENANT}, ${MEETING}, 'Superseded task', ${ASSIGNEE}, '2025-06-10T00:00:00Z', 'medium', 0, 'withdrawn', ${ACTOR}, ${ACTOR})`,
  );
}

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.action_progress where tenant_id = ${TENANT}`;
    await sql`delete from meeting.action_items where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;

    await sql`
      insert into meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
      values (${COMMITTEE}, ${TENANT}, 'Action Item Committee', 'AIC', 'board', '2025-01-01', ${sql.json({ minMembers: 1 })}, ${ACTOR}, ${ACTOR})`;
    await sql`
      insert into meeting.meetings (id, tenant_id, type, title, status, committee_id, secretary_id, financial_year, scheduled_at, quorum_established, created_by, updated_by)
      values (${MEETING}, ${TENANT}, 'committee', 'Action item meeting', 'in_progress', ${COMMITTEE}, ${REAL_SECRETARY}, '2025-26', '2025-06-01T09:00:00Z', true, ${ACTOR}, ${ACTOR})`;
  });
});

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.action_progress where tenant_id = ${TENANT}`;
    await sql`delete from meeting.action_items where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

describe("[BUG] evidence.submit has no terminal-status guard", () => {
  it.fails("must not accept new evidence on an already-COMPLETED action item", async () => {
    const id = randomUUID();
    await seedCompletedItem(id);

    await run(msg(COMMANDS.actionItemEvidence, { actionItemId: id, tenantId: TENANT, evidenceNote: "resubmitted after completion" }));

    const row = await readItem(id);
    expect(row.status).toBe("completed"); // fails today — it flips back to evidence_submitted
  });

  it("characterizes today's actual (buggy) behavior: a completed item is silently un-completed", async () => {
    const id = randomUUID();
    await seedCompletedItem(id);

    await run(msg(COMMANDS.actionItemEvidence, { actionItemId: id, tenantId: TENANT, evidenceNote: "resubmitted after completion" }));

    const row = await readItem(id);
    expect(row.status).toBe("evidence_submitted");
    expect(row.completed_at).not.toBeNull(); // stale completed_at now coexists with a "reopened" status
  });
});

describe("[BUG] verify has no terminal-status guard — re-verification overwrites the original audit trail", () => {
  it.fails("must not re-verify an already-COMPLETED item and overwrite its original verifier", async () => {
    const id = randomUUID();
    await seedCompletedItem(id, REAL_SECRETARY);

    await run(
      msg(COMMANDS.actionItemVerify, { actionItemId: id, tenantId: TENANT, verifierId: ASSIGNEE, verified: true }),
    );

    const row = await readItem(id);
    // Correct behavior: verifying an already-settled item should be rejected, preserving the
    // ORIGINAL verifier's record rather than letting anyone silently overwrite it.
    expect(row.verified_by).toBe(REAL_SECRETARY);
  });

  it("characterizes today's actual (buggy) behavior: the original verifier is silently overwritten", async () => {
    const id = randomUUID();
    await seedCompletedItem(id, REAL_SECRETARY);

    await run(
      msg(COMMANDS.actionItemVerify, { actionItemId: id, tenantId: TENANT, verifierId: ASSIGNEE, verified: true }),
    );

    const row = await readItem(id);
    expect(row.verified_by).toBe(ASSIGNEE); // REAL_SECRETARY's original sign-off is gone
  });

  it.fails("must not reopen a WITHDRAWN (cancelled) item back to in_progress", async () => {
    const id = randomUUID();
    await seedWithdrawnItem(id);

    await run(
      msg(COMMANDS.actionItemVerify, { actionItemId: id, tenantId: TENANT, verifierId: REAL_SECRETARY, verified: false, note: "needs rework" }),
    );

    const row = await readItem(id);
    expect(row.status).toBe("withdrawn");
  });
});

describe("[BUG] verifierId is client-supplied with no self-verification / identity check", () => {
  it.fails("the assignee must not be able to verify their own submitted evidence as themselves", async () => {
    const id = randomUUID();
    await seedEvidenceSubmittedItem(id);

    // The assignee both submits AND "verifies" their own work — msg.actorId is ASSIGNEE, and
    // they name themselves as verifierId too. Nothing in handleVerify compares verifierId to
    // assigneeId, or to msg.actorId, or requires the caller to actually be the meeting's
    // secretary/chairperson.
    await run(
      msg(
        COMMANDS.actionItemVerify,
        { actionItemId: id, tenantId: TENANT, verifierId: ASSIGNEE, verified: true },
        ASSIGNEE, // msg.actorId == the assignee performing self-verification
      ),
    );

    const row = await readItem(id);
    expect(row.verified_by).not.toBe(row.assignee_id);
  });

  it("characterizes today's actual (buggy) behavior: self-verification is accepted and recorded as legitimate", async () => {
    const id = randomUUID();
    await seedEvidenceSubmittedItem(id);

    await run(
      msg(COMMANDS.actionItemVerify, { actionItemId: id, tenantId: TENANT, verifierId: ASSIGNEE, verified: true }, ASSIGNEE),
    );

    const row = await readItem(id);
    expect(row.status).toBe("completed");
    expect(row.verified_by).toBe(ASSIGNEE);
    expect(row.verified_by).toBe(row.assignee_id); // the same person assigned, did, and signed off the work
  });
});
