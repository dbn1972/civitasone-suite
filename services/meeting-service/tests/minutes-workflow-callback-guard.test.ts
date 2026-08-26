/**
 * Minutes module — workflow-completion callback skips the transition guard the HTTP path enforces.
 *
 * Minutes has two independent writers of `meeting.minutes.status`:
 *
 *   - The HTTP path, `handleMinutesApprove` (src/modules/minutes/consumer.ts:~560), which calls
 *     `assertMinutesTransition(current.status, "approved")` — this THROWS unless the record is
 *     currently `"submitted"` (chairperson has actually reviewed it).
 *   - The cross-service callback path, `applyMinutesOutcome`
 *     (src/modules/integration/consumer.ts:232-296), triggered by the external
 *     `workflow.task.completed` event. Its ONLY guard on the approve branch (line 254) is
 *     `if (["approved","signed","circulated"].includes(current.status)) return;` — an
 *     idempotency check (don't re-apply an already-final outcome), NOT a transition check. It
 *     never requires `current.status === "submitted"`. Contrast the reject branch two lines
 *     later (line 273: `if (current.status !== "submitted") return;`), which DOES have the
 *     correct guard — the asymmetry is the tell that the approve branch's check was simply
 *     dropped, not a deliberate design choice.
 *
 * Net effect: a `workflow.task.completed{entityType:"minutes", outcome:"approved"}` message
 * (premature dispatch, a bug in Workflow_Service, or a spoofed/replayed cross-service event)
 * force-approves a minutes record that was still `"draft"` — never submitted, never reviewed by
 * a chairperson. `applyMinutesOutcome` also never computes the hash-chain fields (grep for
 * `hashCurrent|computeHash` in `integration/consumer.ts` — zero hits), so the record ends up
 * "approved" with `hash_current` still NULL, which the tamper-evidence verify path
 * (`minutes/repo.ts` `classifyIntegrity`) will later read as "tampered" for a record that was
 * never legitimately signable in the first place.
 *
 * `it.fails()` encodes the CORRECT behavior (repo precedent:
 * visitor-service/tests/badge-print-revoked-pass.test.ts) — flip to a plain `it()` once fixed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { CONSUMED_EVENTS } from "../src/topics.js";
import { registerIntegrationConsumers } from "../src/modules/integration/consumer.js";

const TENANT = "a0b8b3e6-f10c-4000-8000-0000000000f1";
const COMMITTEE = "b0b8b3e6-f10c-4000-8000-0000000000f1";
const MEETING = "c0b8b3e6-f10c-4000-8000-0000000000f1";
const ACTOR = "e0b8b3e6-f10c-4000-8000-0000000000f1";
const WORKFLOW_ACTOR = "e0b8b3e6-f10c-4000-8000-0000000000fa"; // whoever the workflow event names

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerIntegrationConsumers((topic, h) => handlers.set(topic, h as any));

function msg<T>(type: string, payload: T, messageId = randomUUID()): CommandEnvelope<T> {
  return {
    messageId,
    type,
    tenantId: TENANT,
    actorId: WORKFLOW_ACTOR,
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
async function readMinutes(id: string): Promise<any | null> {
  const rows = await tenantQuery((sql) => sql`select * from meeting.minutes where id = ${id}`);
  return rows[0] ?? null;
}
async function seedDraftMinutes(id: string): Promise<void> {
  await tenantQuery(
    (sql) => sql`
      insert into meeting.minutes
        (id, tenant_id, meeting_id, template_type, content, status, current_version, created_by, updated_by)
      values (${id}, ${TENANT}, ${MEETING}, 'summary', 'Draft minutes content — never submitted for review', 'draft', 1, ${ACTOR}, ${ACTOR})`,
  );
}

function workflowTaskCompleted(minutesId: string, outcome: string) {
  return msg(CONSUMED_EVENTS.workflowTaskCompleted, {
    taskId: randomUUID(),
    tenantId: TENANT,
    entityType: "minutes",
    entityId: minutesId,
    outcome,
    actorId: WORKFLOW_ACTOR,
    completedAt: new Date().toISOString(),
  });
}

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.minutes_versions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.minutes where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;

    await sql`
      insert into meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
      values (${COMMITTEE}, ${TENANT}, 'Callback Committee', 'CC', 'board', '2025-01-01', ${sql.json({ minMembers: 1 })}, ${ACTOR}, ${ACTOR})`;
    await sql`
      insert into meeting.meetings (id, tenant_id, type, title, status, committee_id, financial_year, scheduled_at, quorum_established, created_by, updated_by)
      values (${MEETING}, ${TENANT}, 'committee', 'Callback meeting', 'in_progress', ${COMMITTEE}, '2025-26', '2025-06-01T09:00:00Z', true, ${ACTOR}, ${ACTOR})`;
  });
});

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.minutes_versions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.minutes where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

describe("[BUG] workflow.task.completed force-approves a DRAFT minutes record with no transition check", () => {
  it("sanity: the reject branch correctly ignores a draft record (proves the asymmetry is real)", async () => {
    const minutesId = randomUUID();
    await seedDraftMinutes(minutesId);

    await run(workflowTaskCompleted(minutesId, "rejected"));

    const row = await readMinutes(minutesId);
    expect(row.status).toBe("draft"); // correctly a no-op — reject DOES check status === 'submitted'
  });

  it.fails("must NOT approve a minutes record that is still 'draft' (never submitted for review)", async () => {
    const minutesId = randomUUID();
    await seedDraftMinutes(minutesId);

    await run(workflowTaskCompleted(minutesId, "approved"));

    const row = await readMinutes(minutesId);
    // Correct behavior: approving a draft that skipped chairperson review should be rejected
    // (or at minimum a no-op), the same way the reject branch protects 'draft' records.
    expect(row.status).toBe("draft");
  });

  it("characterizes today's actual (buggy) behavior: the draft IS force-approved, with no hash anchor", async () => {
    const minutesId = randomUUID();
    await seedDraftMinutes(minutesId);

    await run(workflowTaskCompleted(minutesId, "approved"));

    const row = await readMinutes(minutesId);
    expect(row.status).toBe("approved"); // never submitted, never chairperson-reviewed
    expect(row.approved_by).toBe(WORKFLOW_ACTOR);
    expect(row.hash_current).toBeNull(); // applyMinutesOutcome never computes the hash chain
  });
});
