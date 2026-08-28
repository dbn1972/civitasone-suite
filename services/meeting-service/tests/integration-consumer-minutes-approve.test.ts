/**
 * integration module — `workflow.task.completed` minutes-outcome consumer test (real DB).
 *
 * AUDIT FINDING (HIGH): `integration/consumer.ts` `applyMinutesOutcome`'s "approve" branch only
 * excludes already-finalized statuses (`approved`/`signed`/`circulated`) before writing
 * `status: "approved"` directly via `versionedUpdate` — it never requires the row to have been
 * `submitted` first, and never calls `minutes/domain.ts`'s `assertMinutesTransition` (whose own
 * transition table only allows `draft -> submitted`, `submitted -> approved`; see
 * `minutes/domain.ts` `MINUTES_TRANSITIONS`). Contrast the "reject" branch a few lines below in
 * the SAME function, which correctly requires `current.status !== "submitted" -> return` before
 * acting. `minutes/consumer.ts`'s OWN `handleMinutesApprove` (the in-service `minutes.approve`
 * command) correctly enforces the transition table; this is a SEPARATE, parallel write path (a
 * cross-service consumed event) that reimplements the same status change with a weaker guard and
 * skips the state machine entirely.
 *
 * Net effect: a `draft` minutes record — one the secretary never submitted for chairperson
 * review — can be pushed straight to `approved` by a bare `workflow.task.completed` event naming
 * it, bypassing the human-approval gate the rest of this module (and the audit brief's "minutes
 * immutability" concern) is built around. This is the ONLY place `registerIntegrationConsumers`
 * is referenced anywhere in this suite before this file (`tests/worker-wiring.test.ts`, a pure
 * topic-registration check) — `applyMinutesOutcome` had zero behavioral coverage.
 *
 * FIXED: `applyMinutesOutcome`'s approve branch now requires `current.status === "submitted"`
 * (mirroring the reject branch's own precondition two lines below it) before writing
 * `status: "approved"` — any other status, including "draft", is now a silent no-op, exactly
 * like the reject branch already was.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { CONSUMED_EVENTS } from "../src/topics.js";
import { registerIntegrationConsumers } from "../src/modules/integration/consumer.js";

const TENANT = "a5a5a5a5-0000-4000-8000-0000000000c1";
const ACTOR = "b5b5b5b5-0000-4000-8000-0000000000c1";
const MEETING = "c5c5c5c5-0000-4000-8000-0000000000c1";
const WORKFLOW_ACTOR = "d5d5d5d5-0000-4000-8000-0000000000c1";

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerIntegrationConsumers((topic, h) => handlers.set(topic, h as any));

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

async function seedMinutes(status: "draft" | "submitted"): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      await sql`
        insert into meeting.minutes
          (id, tenant_id, meeting_id, template_type, content, status, current_version, created_by, updated_by)
        values (${id}, ${TENANT}, ${MEETING}, 'summary', 'Draft minutes content', ${status}, 1, ${ACTOR}, ${ACTOR})`;
    }),
  );
  return id;
}

async function readMinutes(id: string): Promise<any | null> {
  const rows = await runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select status, approved_by, approved_at from meeting.minutes where id = ${id}`;
    }),
  );
  return rows[0] ?? null;
}

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.minutes where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
    await sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, scheduled_at, created_by, updated_by)
      values (${MEETING}, ${TENANT}, 'committee', 'Workflow-outcome source meeting', 'minutes_pending',
              now() - interval '1 day', ${ACTOR}, ${ACTOR})`;
  });
});

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.minutes where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

describe("workflow.task.completed -> minutes outcome — approval bypasses the submitted gate (SECURITY GAP)", () => {
  it("rejects (or ignores) an 'approve' outcome for a minutes record that was never submitted", async () => {
    const minutesId = await seedMinutes("draft");
    await run(
      msg(CONSUMED_EVENTS.workflowTaskCompleted, {
        taskId: randomUUID(),
        tenantId: TENANT,
        entityType: "minutes",
        entityId: minutesId,
        outcome: "approve",
        actorId: WORKFLOW_ACTOR,
      }),
    );
    const row = await readMinutes(minutesId);
    // Correct behavior: a draft record was never submitted, so this must NOT become "approved".
    expect(row?.status).not.toBe("approved");
  });

  it("[FIXED] a draft minutes record — never submitted — stays draft, untouched by the callback", async () => {
    const minutesId = await seedMinutes("draft");
    await run(
      msg(CONSUMED_EVENTS.workflowTaskCompleted, {
        taskId: randomUUID(),
        tenantId: TENANT,
        entityType: "minutes",
        entityId: minutesId,
        outcome: "approve",
        actorId: WORKFLOW_ACTOR,
      }),
    );
    const row = await readMinutes(minutesId);
    // The secretary never called minutes.submit; no chairperson ever reviewed this content.
    // The callback now silently no-ops instead of force-approving it.
    expect(row?.status).toBe("draft");
    expect(row?.approved_by).toBeNull();
    expect(row?.approved_at).toBeNull();
  });

  it("control: a genuinely submitted minutes record approves cleanly (the mechanism is correct for its intended input)", async () => {
    const minutesId = await seedMinutes("submitted");
    await run(
      msg(CONSUMED_EVENTS.workflowTaskCompleted, {
        taskId: randomUUID(),
        tenantId: TENANT,
        entityType: "minutes",
        entityId: minutesId,
        outcome: "approve",
        actorId: WORKFLOW_ACTOR,
      }),
    );
    const row = await readMinutes(minutesId);
    expect(row?.status).toBe("approved");
  });

  it("contrast: the reject branch DOES correctly require submitted status first (proves the stricter check was achievable here too)", async () => {
    const minutesId = await seedMinutes("draft");
    await run(
      msg(CONSUMED_EVENTS.workflowTaskCompleted, {
        taskId: randomUUID(),
        tenantId: TENANT,
        entityType: "minutes",
        entityId: minutesId,
        outcome: "reject",
        actorId: WORKFLOW_ACTOR,
      }),
    );
    // Rejecting a draft (never submitted) is correctly a no-op — status is untouched.
    const row = await readMinutes(minutesId);
    expect(row?.status).toBe("draft");
  });

  it("rejects the callback for an unknown minutes id (permanent -> DLQ)", async () => {
    await expect(
      run(
        msg(CONSUMED_EVENTS.workflowTaskCompleted, {
          taskId: randomUUID(),
          tenantId: TENANT,
          entityType: "minutes",
          entityId: randomUUID(),
          outcome: "approve",
          actorId: WORKFLOW_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });
});
