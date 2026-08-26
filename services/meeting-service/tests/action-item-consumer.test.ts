/**
 * action-item module — consumer integration tests (task 11.2) against the real DB.
 *
 * Exercises the action-item command handlers end-to-end against Postgres inside
 * `runWithTenant(TENANT, …)` (sets the `app.tenant_id` GUC for RLS, exactly as the worker does
 * via `withTenantConsumer`). No external I/O is required — notifications/events are written to the
 * transactional outbox (`_outbox.messages`) in the same transaction.
 *
 * Focus (per task 11.2):
 *   • assign      — INSERT + SLA/next-escalation window + assignee notification (Req 9.1, 9.3)
 *   • acknowledge — records acknowledged_at + advances to acknowledged (Req 9.4)
 *   • progress    — appends an action_progress row + advances to in_progress (Req 9.x, 10.2)
 *   • evidence    — records evidence + moves to evidence_submitted + notifies verifier (Req 9.7)
 *   • verify      — evidence-before-verification (P22) + transition to completed (Req 9.7)
 *   • escalate    — monotonic level bump + chain notify + ATR auto-inclusion (Req 9.5, 9.6, 9.8)
 *   • idempotency (P30) — processing the SAME messageId twice yields exactly one write
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { registerActionItemConsumers } from "../src/modules/action-item/consumer.js";

const TENANT = "c9c9c9c9-0000-4000-8000-0000000000a1";
const ACTOR = "90000000-0000-4000-8000-0000000000a1";
const COMMITTEE = "d9d9d9d9-0000-4000-8000-0000000000a1";
const MEETING = "e9e9e9e9-0000-4000-8000-0000000000a1"; // in-progress source meeting
const NEXT_MEETING = "f9f9f9f9-0000-4000-8000-0000000000a1"; // committee's next scheduled meeting
const SECRETARY = "11111111-0000-4000-8000-0000000000a1";
const CHAIR = "22222222-0000-4000-8000-0000000000a1";
const ASSIGNEE = "33333333-0000-4000-8000-0000000000a1";

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerActionItemConsumers((topic, h) => handlers.set(topic, h as any));

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

async function readItem(id: string): Promise<any | null> {
  return runWithTenant(TENANT, async () => {
    const rows = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select id, status, sla_hours, escalation_level, next_escalation_at, acknowledged_at,
                        evidence_url, evidence_note, verified_by, verified_at, completed_at, overdue_at, version
                 from meeting.action_items where id = ${id}`;
    });
    return rows[0] ?? null;
  });
}

async function progressCount(actionItemId: string): Promise<number> {
  const rows = await runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select count(*)::int as n from meeting.action_progress where action_item_id = ${actionItemId}`;
    }),
  );
  return rows[0].n as number;
}

async function outboxCount(topic: string): Promise<number> {
  const rows = await runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select count(*)::int as n from _outbox.messages where tenant_id = ${TENANT} and topic = ${topic}`;
    }),
  );
  return rows[0].n as number;
}

async function atrAgendaCount(meetingId: string): Promise<number> {
  const rows = await runWithTenant(TENANT, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select count(*)::int as n from meeting.agenda_items
                 where meeting_id = ${meetingId} and title = 'Action Taken Report (ATR)'`;
    }),
  );
  return rows[0].n as number;
}

const HOUR = 3_600_000;

/** Assign helper: deadline defaults to 24h ahead (after the meeting start). */
function assignMsg(actionItemId: string, opts: { deadline?: string; priority?: string } = {}) {
  return msg(
    COMMANDS.actionItemAssign,
    {
      actionItemId,
      meetingId: MEETING,
      tenantId: TENANT,
      description: "Publish the sanctioned budget circular",
      assigneeId: ASSIGNEE,
      deadline: opts.deadline ?? new Date(Date.now() + 24 * HOUR).toISOString(),
      priority: opts.priority ?? "high",
    },
    actionItemId, // messageId == actionItemId (natural idempotency, P30)
  );
}

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    // Fix 8: meeting.meetings.committee_id now carries a real FK to meeting.committees — this
    // fixture's meetings reference COMMITTEE, so a row for it must actually exist.
    await sql`
      insert into meeting.committees (id, tenant_id, name, code, type, constitution_date, quorum_rule, created_by, updated_by)
      values (${COMMITTEE}, ${TENANT}, 'Action Item Test Committee', 'AIC', 'standing', '2025-01-01', ${'{"minMembers":2}'}::jsonb, ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
    // Source meeting: in-progress (actual_start_at set) so deadlines validate against it (P19).
    await sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, committee_id, chairperson_id, secretary_id,
         scheduled_at, actual_start_at, meeting_number, created_by, updated_by)
      values (${MEETING}, ${TENANT}, 'committee', 'Action Item Source', 'in_progress', ${COMMITTEE},
              ${CHAIR}, ${SECRETARY}, now() - interval '2 hours', now() - interval '1 hour',
              'MTG/2025-26/010', ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
    // The committee's next scheduled meeting — where overdue items must surface as an ATR (Req 9.8).
    await sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, committee_id, chairperson_id, secretary_id,
         scheduled_at, meeting_number, created_by, updated_by)
      values (${NEXT_MEETING}, ${TENANT}, 'committee', 'Action Item Next', 'scheduled', ${COMMITTEE},
              ${CHAIR}, ${SECRETARY}, now() + interval '7 days', 'MTG/2025-26/011', ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
  });
});

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.action_progress where tenant_id = ${TENANT}`;
    await sql`delete from meeting.action_items where tenant_id = ${TENANT}`;
    await sql`delete from meeting.agenda_items where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

describe("action_item full lifecycle: assign → acknowledge → progress → evidence → verify", () => {
  it("assigns with an SLA window + next-escalation trigger, notifies the assignee, is idempotent (P30)", async () => {
    const id = randomUUID();
    const m = assignMsg(id);
    const notifBefore = await outboxCount("notification.send");

    await run(m);

    const row = await readItem(id);
    expect(row).toBeTruthy();
    expect(row.status).toBe("assigned");
    expect(row.escalation_level).toBe(0);
    // SLA window derived from the deadline (~24h) and the first escalation trigger set (deadline + 24h).
    expect(row.sla_hours).toBeGreaterThanOrEqual(23);
    expect(row.next_escalation_at).not.toBeNull();
    expect(await outboxCount(EVENTS.actionItemAssigned)).toBeGreaterThan(0);
    expect(await outboxCount("notification.send")).toBe(notifBefore + 1);

    // Redelivery with the SAME messageId is a no-op (markProcessed skip) — still exactly one row.
    await run(m);
    const count = await runWithTenant(TENANT, () =>
      sqlClient.begin(async (sql) => {
        await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
        return sql`select count(*)::int as n from meeting.action_items where id = ${id}`;
      }),
    );
    expect(count[0].n).toBe(1);
  });

  it("acknowledges (records acknowledged_at + advances state)", async () => {
    const id = randomUUID();
    await run(assignMsg(id));

    await run(msg(COMMANDS.actionItemAcknowledge, { actionItemId: id, tenantId: TENANT, version: 1 }));

    const row = await readItem(id);
    expect(row.status).toBe("acknowledged");
    expect(row.acknowledged_at).not.toBeNull();
  });

  it("appends a progress row and advances to in_progress", async () => {
    const id = randomUUID();
    await run(assignMsg(id));

    await run(msg(COMMANDS.actionItemProgress, {
      actionItemId: id, tenantId: TENANT, updateText: "Draft circular prepared", percentage: 40,
    }));

    expect(await progressCount(id)).toBe(1);
    expect((await readItem(id)).status).toBe("in_progress");
  });

  it("records evidence, moves to evidence_submitted, and notifies the verifier", async () => {
    const id = randomUUID();
    await run(assignMsg(id));
    const notifBefore = await outboxCount("notification.send");

    await run(msg(COMMANDS.actionItemEvidence, {
      actionItemId: id, tenantId: TENANT, evidenceUrl: "https://minio.local/evidence/circular.pdf",
    }));

    const row = await readItem(id);
    expect(row.status).toBe("evidence_submitted");
    expect(row.evidence_url).toBe("https://minio.local/evidence/circular.pdf");
    expect(await outboxCount(EVENTS.actionItemEvidenceSubmitted)).toBeGreaterThan(0);
    // Verifier (secretary) notified.
    expect(await outboxCount("notification.send")).toBe(notifBefore + 1);
  });

  it("verifies submitted evidence → completed (P22 satisfied)", async () => {
    const id = randomUUID();
    await run(assignMsg(id));
    await run(msg(COMMANDS.actionItemEvidence, {
      actionItemId: id, tenantId: TENANT, evidenceNote: "Circular #123 issued and filed",
    }));

    await run(msg(COMMANDS.actionItemVerify, {
      actionItemId: id, tenantId: TENANT, verifierId: SECRETARY, verified: true,
    }));

    const row = await readItem(id);
    expect(row.status).toBe("completed");
    expect(row.verified_by).toBe(SECRETARY);
    expect(row.verified_at).not.toBeNull();
    expect(row.completed_at).not.toBeNull();
    expect(await outboxCount(EVENTS.actionItemCompleted)).toBeGreaterThan(0);
  });

  it("rejects verification when no evidence is present (P22 → permanent/DLQ error)", async () => {
    const id = randomUUID();
    await run(assignMsg(id));

    await expect(
      run(msg(COMMANDS.actionItemVerify, {
        actionItemId: id, tenantId: TENANT, verifierId: SECRETARY, verified: true,
      })),
    ).rejects.toBeInstanceOf(NonRetryableError);
    // Untouched — still assigned.
    expect((await readItem(id)).status).toBe("assigned");
  });
});

describe("action_item ownership — assignee self-scope (SECURITY GAP)", () => {
  /**
   * AUDIT FINDING (HIGH): routes.ts's own RBAC doc comment claims: "committee_member — Update own
   * + act on their own assignment (acknowledge/progress/evidence). The self-scope (assignee ==
   * actor) is not enforced here at the role gate; the consumer owns the per-row rules." That claim
   * is false: `handleAcknowledge` / `handleProgress` / `handleEvidence` load the row and mutate it
   * without ever comparing `msg.actorId` to `row.assigneeId`. Any authenticated `committee_member`
   * (a coarse, tenant-wide role — not scoped to being THIS item's assignee) can acknowledge, log
   * progress on, or submit fabricated "evidence" for ANY OTHER member's assigned action item.
   * `ACTOR` (the command's authenticated sender throughout this file, via `msg()`) is a distinct
   * identity from `ASSIGNEE` (who every item below is actually assigned to) — every call in this
   * block acts on ASSIGNEE's item as ACTOR, and none of them are ASSIGNEE.
   *
   * `it.fails()` asserts the CORRECT (claimed) behavior — currently failing, because the consumer
   * silently allows it. Flip each to a plain `it()` once ownership is enforced. The plain
   * "[BLAST RADIUS]" case documents the real current behavior end-to-end: a non-assignee can walk
   * a stranger's action item all the way to `completed` without the assignee ever acting.
   */
  it.fails("rejects an acknowledge from someone other than the item's assignee", async () => {
    const id = randomUUID();
    await run(assignMsg(id)); // assigned to ASSIGNEE; the command below runs as ACTOR
    await expect(
      run(msg(COMMANDS.actionItemAcknowledge, { actionItemId: id, tenantId: TENANT, version: 1 })),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });

  it.fails("rejects a progress update from someone other than the item's assignee", async () => {
    const id = randomUUID();
    await run(assignMsg(id));
    await expect(
      run(msg(COMMANDS.actionItemProgress, {
        actionItemId: id, tenantId: TENANT, updateText: "fabricated by a non-assignee", percentage: 90,
      })),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });

  it.fails("rejects evidence submitted by someone other than the item's assignee", async () => {
    const id = randomUUID();
    await run(assignMsg(id));
    await expect(
      run(msg(COMMANDS.actionItemEvidence, {
        actionItemId: id, tenantId: TENANT, evidenceUrl: "https://minio.local/evidence/forged.pdf",
      })),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });

  it("[BLAST RADIUS] a non-assignee can single-handedly fabricate evidence and have it verified completed — the real assignee never acts", async () => {
    const id = randomUUID();
    await run(assignMsg(id)); // assigned to ASSIGNEE, who does nothing below — ACTOR does it all
    await run(msg(COMMANDS.actionItemAcknowledge, { actionItemId: id, tenantId: TENANT, version: 1 }));
    await run(msg(COMMANDS.actionItemProgress, {
      actionItemId: id, tenantId: TENANT, updateText: "done (by ACTOR, not ASSIGNEE)", percentage: 100,
    }));
    await run(msg(COMMANDS.actionItemEvidence, {
      actionItemId: id, tenantId: TENANT, evidenceUrl: "https://minio.local/evidence/forged.pdf",
    }));
    // The verifier has no signal that ASSIGNEE — the officer of record — never touched this item.
    await run(msg(COMMANDS.actionItemVerify, { actionItemId: id, tenantId: TENANT, verifierId: SECRETARY, verified: true }));
    const row = await readItem(id);
    expect(row.status).toBe("completed");
    expect(row.evidence_url).toBe("https://minio.local/evidence/forged.pdf");
  });
});

describe("action_item escalate (Req 9.5, 9.6, 9.8)", () => {
  it("advances the escalation level, marks overdue, and tables an ATR on the next meeting", async () => {
    const id = randomUUID();
    // A short deadline so the item is genuinely past-due, but still after the meeting start (P19).
    await run(assignMsg(id, { deadline: new Date(Date.now() + HOUR).toISOString() }));

    await run(msg(COMMANDS.actionItemEscalate, { actionItemId: id, tenantId: TENANT, toLevel: 1 }));

    const row = await readItem(id);
    expect(row.status).toBe("escalated");
    expect(row.escalation_level).toBe(1);
    expect(row.overdue_at).not.toBeNull();
    expect(await outboxCount(EVENTS.actionItemEscalated)).toBeGreaterThan(0);
    // Req 9.8: an ATR agenda item now exists on the committee's next scheduled meeting.
    expect(await atrAgendaCount(NEXT_MEETING)).toBe(1);

    // A second escalation to the same/next level does not create a duplicate ATR item.
    await run(msg(COMMANDS.actionItemEscalate, { actionItemId: id, tenantId: TENANT, toLevel: 2 }));
    expect((await readItem(id)).escalation_level).toBe(2);
    expect(await atrAgendaCount(NEXT_MEETING)).toBe(1);
  });

  it("rejects a non-monotonic (downward) escalation as a permanent/DLQ error (P20)", async () => {
    const id = randomUUID();
    await run(assignMsg(id, { deadline: new Date(Date.now() + HOUR).toISOString() }));
    await run(msg(COMMANDS.actionItemEscalate, { actionItemId: id, tenantId: TENANT, toLevel: 2 }));

    await expect(
      run(msg(COMMANDS.actionItemEscalate, { actionItemId: id, tenantId: TENANT, toLevel: 1 })),
    ).rejects.toBeInstanceOf(NonRetryableError);
    expect((await readItem(id)).escalation_level).toBe(2);
  });
});
