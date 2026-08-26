/**
 * integration module — workflow.task.completed can approve minutes directly from `draft`,
 * skipping the `submitted` gate (audit finding). Also the first behavioral test coverage this
 * module's `applyMinutesOutcome` / `applyResolutionOutcome` handlers have ever had — the only
 * existing reference to `registerIntegrationConsumers` in the whole suite
 * (tests/worker-wiring.test.ts) only asserts that the topic is WIRED to a handler, never
 * exercises the handler's logic.
 *
 * src/modules/integration/consumer.ts `applyMinutesOutcome` (:232-296):
 *   - reject path (:271-273):  `if (current.status !== "submitted") return;` — correctly
 *     refuses to reject anything not awaiting approval.
 *   - approve path (:252-254): `if (["approved","signed","circulated"].includes(current.status))
 *     return;` — ANY OTHER status, including "draft", falls through and is approved. There is
 *     no symmetric `current.status !== "submitted"` guard on the approve branch.
 *
 * Why this matters for THIS audit's brief specifically: ai-assist's human-approval invariant
 * (P37, ai-assist/domain.ts `buildAiMinutesDraft` / `assertAiMinutesNeverAutoApproved`) is
 * carefully enforced *within ai-assist's own consumer* — an AI-drafted minutes row is always
 * persisted as `{ status: "draft", aiGenerated: true }` and ai-assist itself never sets
 * "approved". But that invariant only constrains ai-assist's OWN write path. This handler is a
 * SEPARATE mechanism (a consumed cross-service event, `workflow.task.completed`, owned by
 * workflow-service) that writes `status = "approved"` onto a minutes row identified only by
 * `entityId` — and it never checks that the row was ever actually submitted through the human
 * review gate (`minutes.submit`, which flips draft → submitted) before honouring an "approve"
 * outcome. A still-`draft`, `aiGenerated = true`, never-submitted minutes document can reach
 * `approved` through this path with no human ever having reviewed it — precisely the outcome
 * P37 exists to prevent, reached by a route P37's own guards don't cover.
 *
 * Exploitability is bounded by trust in workflow-service (this is a CONSUMED_EVENTS handler,
 * off the internal bus, not a user-facing HTTP route) — but that is exactly the same trust
 * boundary every other consumed-event handler in this file operates under, and the reject path
 * demonstrates the stricter, correct check was entirely achievable here too.
 *
 * Severity: MEDIUM-HIGH (governance-integrity impact; trust-boundary-gated reachability).
 * Live-proven against the real Postgres DB.
 *
 * FIXED: `applyMinutesOutcome`'s approve branch (integration/consumer.ts) now requires
 * `current.status === "submitted"` before writing "approved" — the asymmetry with the reject
 * branch is gone, and P37's human-approval invariant is no longer reachable-around through this
 * cross-service path.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { CONSUMED_EVENTS, EVENTS } from "../src/topics.js";
import { registerIntegrationConsumers } from "../src/modules/integration/consumer.js";

const TENANT = "a9a9a9a9-0000-4000-8000-0000000c1a57";
const ACTOR = "90000000-0000-4000-8000-0000000c1a57";
const WORKFLOW_ACTOR = "a0000000-0000-4000-8000-0000000f10cc"; // "workflow" service actor on the event
const MEETING = "b9b90001-0000-4000-8000-0000000c1a57";
const DRAFT_AI_MINUTES = "d9d90001-0000-4000-8000-0000000c1a57";
const SUBMITTED_MINUTES = "d9d90002-0000-4000-8000-0000000c1a57";

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerIntegrationConsumers((topic, h) => handlers.set(topic, h as any));

function msg<T>(payload: T, messageId = randomUUID()): CommandEnvelope<T> {
  return {
    messageId,
    type: CONSUMED_EVENTS.workflowTaskCompleted,
    tenantId: TENANT,
    actorId: WORKFLOW_ACTOR,
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload,
  } as CommandEnvelope<T>;
}
function run<T>(m: CommandEnvelope<T>): Promise<void> {
  const handler = handlers.get(CONSUMED_EVENTS.workflowTaskCompleted);
  if (!handler) throw new Error("no handler registered for workflow.task.completed");
  return runWithTenant(TENANT, () => handler(m)) as Promise<void>;
}

async function readMinutes(id: string): Promise<any> {
  const rows = await runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select status, ai_generated, approved_by, approved_at from meeting.minutes where id = ${id}`;
    }),
  );
  return rows[0];
}

async function outboxHas(topic: string, minutesId: string): Promise<boolean> {
  const rows = await runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select payload from _outbox.messages where tenant_id = ${TENANT} and topic = ${topic}`;
    }),
  );
  return rows.some((r: any) => r.payload?.minutesId === minutesId);
}

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, scheduled_at, created_by, updated_by)
      values (${MEETING}, ${TENANT}, 'committee', 'Workflow Draft-Approve Test', 'minutes_pending',
              now() - interval '1 day', ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;

    // An AI-drafted minutes document, exactly as ai-assist's handleAiDraftMinutes leaves it:
    // status = draft, ai_generated = true, NEVER submitted by any human (Req 17.x, P37).
    await sql`
      insert into meeting.minutes
        (id, tenant_id, meeting_id, template_type, content, status, current_version, ai_generated, created_by, updated_by)
      values (${DRAFT_AI_MINUTES}, ${TENANT}, ${MEETING}, 'summary', 'AI-drafted content pending human review', 'draft', 1, true, ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;

    // Control-group row: a properly submitted (human-initiated) minutes, to prove the approve
    // path also works correctly for the case it's actually meant for.
    await sql`
      insert into meeting.minutes
        (id, tenant_id, meeting_id, template_type, content, status, current_version, ai_generated, created_by, updated_by)
      values (${SUBMITTED_MINUTES}, ${TENANT}, ${MEETING}, 'summary', 'Human-drafted, properly submitted', 'submitted', 1, false, ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
  });
});

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.minutes_versions where tenant_id = ${TENANT}`;
    await sql`delete from meeting.minutes where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

describe("FIXED: workflow.task.completed(outcome=approve) no longer approves minutes still in draft", () => {
  it("sanity: the AI-drafted minutes really is draft/ai_generated, never submitted", async () => {
    const row = await readMinutes(DRAFT_AI_MINUTES);
    expect(row.status).toBe("draft");
    expect(row.ai_generated).toBe(true);
  });

  it("a workflow-service 'approve' completion event no longer flips an UNSUBMITTED, AI-generated draft to approved", async () => {
    await run(
      msg({
        taskId: randomUUID(),
        tenantId: TENANT,
        entityType: "minutes",
        entityId: DRAFT_AI_MINUTES,
        outcome: "approve",
        actorId: WORKFLOW_ACTOR,
        completedAt: new Date().toISOString(),
      }),
    );

    const row = await readMinutes(DRAFT_AI_MINUTES);
    // An AI-generated draft that no human ever submitted for review must NOT reach "approved"
    // through this cross-service callback — P37 (ai-assist/domain.ts
    // assertAiMinutesNeverAutoApproved) constrains ai-assist's own consumer; this handler's own
    // submitted-status guard now closes the separate path around it.
    expect(row.status).toBe("draft");
    expect(row.ai_generated).toBe(true);
    expect(row.approved_by).toBeNull();
    expect(await outboxHas(EVENTS.minutesApproved, DRAFT_AI_MINUTES)).toBe(false);
  });

  it("control group: a PROPERLY submitted minutes is also approved correctly by the same handler (the mechanism itself works — only the missing submitted-gate on approve is the bug)", async () => {
    await run(
      msg({
        taskId: randomUUID(),
        tenantId: TENANT,
        entityType: "minutes",
        entityId: SUBMITTED_MINUTES,
        outcome: "approve",
        actorId: WORKFLOW_ACTOR,
        completedAt: new Date().toISOString(),
      }),
    );
    const row = await readMinutes(SUBMITTED_MINUTES);
    expect(row.status).toBe("approved");
  });

  it("contrast — the REJECT path correctly refuses to act on a non-submitted minutes (proving the approve path's missing guard is an asymmetry, not a deliberate design choice)", async () => {
    // Re-seed a second fresh draft (the first was consumed by the approve test above).
    const secondDraft = randomUUID();
    await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      await sql`
        insert into meeting.minutes
          (id, tenant_id, meeting_id, template_type, content, status, current_version, ai_generated, created_by, updated_by)
        values (${secondDraft}, ${TENANT}, ${MEETING}, 'summary', 'Another AI draft', 'draft', 1, true, ${ACTOR}, ${ACTOR})`;
    });

    await run(
      msg({
        taskId: randomUUID(),
        tenantId: TENANT,
        entityType: "minutes",
        entityId: secondDraft,
        outcome: "reject",
        actorId: WORKFLOW_ACTOR,
        completedAt: new Date().toISOString(),
      }),
    );

    const row = await readMinutes(secondDraft);
    // draft.status !== "submitted" -> the handler's `if (current.status !== "submitted") return;`
    // guard correctly no-ops; status is untouched. The approve branch has no equivalent guard.
    expect(row.status).toBe("draft");
  });
});
