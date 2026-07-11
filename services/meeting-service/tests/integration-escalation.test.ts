/**
 * Integration test — action item escalation lifecycle (task 22.4).
 *
 * Verifies the full escalation flow end-to-end:
 *   1. Assign an action item via the consumer (handleAssign)
 *   2. Miss the deadline → overdue detection
 *   3. Run the escalation worker at successive time points:
 *      - deadline + 25h → Level 1 (supervisor)
 *      - deadline + 73h → Level 2 (department head)
 *      - deadline + 7d + 1h → Level 3 (chairperson)
 *   4. Verify DB state advances (escalation_level, status, next_escalation_at)
 *   5. Verify outbox messages are emitted for notifications at each level
 *   6. Verify the ATR report (getATR) includes the overdue item
 *
 * Uses the action-item consumer (assign handler) + the escalation worker (runActionItemEscalation)
 * with injected `now` values at successive points in the escalation timeline. Tests run against the
 * live Postgres instance (matching the pattern in action-item-consumer.test.ts).
 *
 * _Requirements: 9.1, 9.4, 9.5, 9.6, 9.7, 10.1, 10.4_
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope } from "@civitasone/queue";
import { sqlClient } from "../src/shared/db.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { registerActionItemConsumers } from "../src/modules/action-item/consumer.js";
import {
  runActionItemEscalation,
  type EscalationCandidate,
  type EscalationAction,
  type OutboxMessageInput,
} from "../src/workers/action-item-escalation.js";
import { NOTIFICATION_SEND } from "@civitasone/events";

// ─── Constants ────────────────────────────────────────────────────────────────

const TENANT = "e1e1e1e1-0000-4000-8000-000000000e01";
const ACTOR = "e1e1e1e1-0000-4000-8000-000000000e02";
const COMMITTEE = "e1e1e1e1-0000-4000-8000-000000000e03";
const MEETING = "e1e1e1e1-0000-4000-8000-000000000e04";
const NEXT_MEETING = "e1e1e1e1-0000-4000-8000-000000000e05";
const SECRETARY = "e1e1e1e1-0000-4000-8000-000000000e06";
const CHAIR = "e1e1e1e1-0000-4000-8000-000000000e07";
const ASSIGNEE = "e1e1e1e1-0000-4000-8000-000000000e08";

const HOUR = 3_600_000;

// ─── Consumer handler registration ───────────────────────────────────────────

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerActionItemConsumers((topic, h) => handlers.set(topic, h as any));

function envelope<T>(type: string, payload: T, messageId = randomUUID()): CommandEnvelope<T> {
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

function runHandler<T>(m: CommandEnvelope<T>): Promise<void> {
  const handler = handlers.get(m.type);
  if (!handler) throw new Error(`no handler for ${m.type}`);
  return runWithTenant(TENANT, () => handler(m)) as Promise<void>;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function readItem(id: string): Promise<any | null> {
  return runWithTenant(TENANT, async () => {
    const rows = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select id, status, escalation_level, next_escalation_at, overdue_at, deadline, version
                 from meeting.action_items where id = ${id}`;
    });
    return rows[0] ?? null;
  });
}

async function outboxCount(topic: string): Promise<number> {
  return runWithTenant(TENANT, async () => {
    const rows = await sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
      return sql`select count(*)::int as n from _outbox.messages
                 where tenant_id = ${TENANT} and topic = ${topic}`;
    });
    return rows[0].n as number;
  });
}

/**
 * Shared emit callback: applies the escalation to the DB and writes outbox messages.
 * Collects emitted messages in the provided array for assertion.
 */
function makeEmit(actionItemId: string, collected: OutboxMessageInput[]) {
  return async (action: EscalationAction, messages: OutboxMessageInput[]) => {
    collected.push(...messages);
    await runWithTenant(TENANT, async () => {
      await sqlClient.begin(async (sql) => {
        await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
        const nextEsc = action.nextEscalationAt?.toISOString() ?? null;
        await sql`
          update meeting.action_items
          set escalation_level = ${action.toLevel},
              status = 'escalated',
              overdue_at = coalesce(overdue_at, deadline),
              next_escalation_at = ${nextEsc}::timestamptz,
              updated_at = now(),
              version = version + 1
          where id = ${actionItemId} and tenant_id = ${TENANT}`;
        for (const m of messages) {
          await sql`
            insert into _outbox.messages
              (id, tenant_id, topic, event_type, actor_id, correlation_id, payload, created_at)
            values
              (${randomUUID()}, ${m.tenantId}, ${m.topic}, ${m.eventType},
               ${m.actorId}, ${m.correlationId},
               ${JSON.stringify(m.payload)}::jsonb, now())`;
        }
      });
    });
  };
}

// ─── Test fixtures ────────────────────────────────────────────────────────────

/** The meeting start time. */
const MEETING_START = new Date("2026-06-10T08:00:00Z");
/** A deadline set after meeting start (satisfies P19). */
const DEADLINE = new Date("2026-06-11T10:00:00Z");

beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    // Committee for ATR
    await sql`
      insert into meeting.committees
        (id, tenant_id, name, type, constitution_date, quorum_rule, created_by, updated_by)
      values (${COMMITTEE}, ${TENANT}, 'Escalation Test Committee', 'standing',
              '2025-01-01', '{"minMembers": 3}', ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
    // Source meeting: in-progress with actual_start_at set (P19 prerequisite)
    await sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, committee_id, chairperson_id, secretary_id,
         scheduled_at, actual_start_at, meeting_number, created_by, updated_by)
      values (${MEETING}, ${TENANT}, 'committee', 'Escalation Source Meeting', 'in_progress',
              ${COMMITTEE}, ${CHAIR}, ${SECRETARY},
              ${MEETING_START.toISOString()}::timestamptz, ${MEETING_START.toISOString()}::timestamptz,
              'ESC/2025-26/001', ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
    // Next meeting for ATR auto-inclusion (Req 9.8)
    await sql`
      insert into meeting.meetings
        (id, tenant_id, type, title, status, committee_id, chairperson_id, secretary_id,
         scheduled_at, meeting_number, created_by, updated_by)
      values (${NEXT_MEETING}, ${TENANT}, 'committee', 'Escalation Next Meeting', 'scheduled',
              ${COMMITTEE}, ${CHAIR}, ${SECRETARY},
              ${new Date(DEADLINE.getTime() + 14 * 24 * HOUR).toISOString()}::timestamptz,
              'ESC/2025-26/002', ${ACTOR}, ${ACTOR})
      on conflict (id) do nothing`;
  });
});

afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`delete from meeting.action_progress where tenant_id = ${TENANT}`;
    await sql`delete from meeting.action_items where tenant_id = ${TENANT}`;
    await sql`delete from meeting.agenda_items where tenant_id = ${TENANT}`;
    await sql`delete from _outbox.messages where tenant_id = ${TENANT}`;
    await sql`delete from meeting.meetings where tenant_id = ${TENANT}`;
    await sql`delete from meeting.committees where tenant_id = ${TENANT}`;
  });
  await sqlClient.end();
});

// ─── Integration test suite ──────────────────────────────────────────────────

describe("integration: action item escalation lifecycle (Req 9.1, 9.4, 9.5, 9.6, 9.7, 10.1, 10.4)", () => {
  const ACTION_ITEM_ID = randomUUID();

  /** Build an EscalationCandidate from the current DB row. */
  async function buildCandidate(): Promise<EscalationCandidate> {
    const row = await readItem(ACTION_ITEM_ID);
    return {
      actionItemId: ACTION_ITEM_ID,
      tenantId: TENANT,
      meetingId: MEETING,
      assigneeId: ASSIGNEE,
      deadline: new Date(row.deadline),
      overdueAt: row.overdue_at ? new Date(row.overdue_at) : null,
      escalationLevel: row.escalation_level,
      status: row.status,
      version: row.version,
      chairpersonId: CHAIR,
      secretaryId: SECRETARY,
    };
  }

  it("step 1: assigns the action item (Req 9.1, 9.3)", async () => {
    const m = envelope(
      COMMANDS.actionItemAssign,
      {
        actionItemId: ACTION_ITEM_ID,
        meetingId: MEETING,
        tenantId: TENANT,
        description: "Submit quarterly compliance report",
        assigneeId: ASSIGNEE,
        deadline: DEADLINE.toISOString(),
        priority: "high",
      },
      ACTION_ITEM_ID,
    );

    await runHandler(m);

    const row = await readItem(ACTION_ITEM_ID);
    expect(row).not.toBeNull();
    expect(row.status).toBe("assigned");
    expect(row.escalation_level).toBe(0);
    // next_escalation_at should be set to deadline + 24h (first rung)
    const nextEsc = new Date(row.next_escalation_at);
    expect(nextEsc.getTime()).toBe(DEADLINE.getTime() + 24 * HOUR);
    // Notification emitted for the assignee
    expect(await outboxCount("notification.send")).toBeGreaterThan(0);
  });

  it("step 2: deadline passes — worker escalates to Level 1 (Req 9.4, 9.5)", async () => {
    const nowL1 = new Date(DEADLINE.getTime() + 25 * HOUR);
    const candidate = await buildCandidate();
    expect(candidate.escalationLevel).toBe(0);

    const emitted: OutboxMessageInput[] = [];
    const result = await runActionItemEscalation({
      now: nowL1,
      loadCandidates: async () => [candidate],
      emit: makeEmit(ACTION_ITEM_ID, emitted),
    });

    expect(result.scanned).toBe(1);
    expect(result.escalated).toBe(1);
    expect(result.failed).toBe(0);

    // Verify DB state
    const updated = await readItem(ACTION_ITEM_ID);
    expect(updated.escalation_level).toBe(1);
    expect(updated.status).toBe("escalated");
    expect(new Date(updated.next_escalation_at).getTime()).toBe(DEADLINE.getTime() + 72 * HOUR);
    expect(updated.overdue_at).not.toBeNull();

    // Verify escalation event
    const events = emitted.filter((m) => m.topic === EVENTS.actionItemEscalated);
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      actionItemId: ACTION_ITEM_ID,
      toLevel: 1,
      notify: "supervisor",
    });

    // Notifications: assignee + secretary (L1 fallback)
    const notifs = emitted.filter((m) => m.topic === NOTIFICATION_SEND);
    expect(notifs.length).toBeGreaterThanOrEqual(2);

    // Audit fact
    const audits = emitted.filter((m) => m.topic === "audit.event.record");
    expect(audits).toHaveLength(1);
    expect(audits[0].payload).toMatchObject({ action: "escalate", metadata: { fromLevel: 0, toLevel: 1 } });
  });

  it("step 3: escalates to Level 2 after deadline + 73h (Req 9.5, 9.6)", async () => {
    const nowL2 = new Date(DEADLINE.getTime() + 73 * HOUR);
    const candidate = await buildCandidate();
    expect(candidate.escalationLevel).toBe(1);

    const emitted: OutboxMessageInput[] = [];
    const result = await runActionItemEscalation({
      now: nowL2,
      loadCandidates: async () => [candidate],
      emit: makeEmit(ACTION_ITEM_ID, emitted),
    });

    expect(result.escalated).toBe(1);

    const updated = await readItem(ACTION_ITEM_ID);
    expect(updated.escalation_level).toBe(2);
    expect(updated.status).toBe("escalated");
    expect(new Date(updated.next_escalation_at).getTime()).toBe(DEADLINE.getTime() + 168 * HOUR);

    // L2 event
    const events = emitted.filter((m) => m.topic === EVENTS.actionItemEscalated);
    expect(events[0].payload).toMatchObject({ toLevel: 2, notify: "department_head" });

    // Notifications at L2: assignee + secretary
    const notifs = emitted.filter((m) => m.topic === NOTIFICATION_SEND);
    expect(notifs.length).toBeGreaterThanOrEqual(2);
  });

  it("step 4: escalates to Level 3 after deadline + 7d (Req 9.5, 9.6) — chairperson notified", async () => {
    const nowL3 = new Date(DEADLINE.getTime() + (24 * 7 + 1) * HOUR);
    const candidate = await buildCandidate();
    expect(candidate.escalationLevel).toBe(2);

    const emitted: OutboxMessageInput[] = [];
    const result = await runActionItemEscalation({
      now: nowL3,
      loadCandidates: async () => [candidate],
      emit: makeEmit(ACTION_ITEM_ID, emitted),
    });

    expect(result.escalated).toBe(1);

    const updated = await readItem(ACTION_ITEM_ID);
    expect(updated.escalation_level).toBe(3);
    expect(updated.status).toBe("escalated");
    // At L3 (top of chain), next_escalation_at should be null
    expect(updated.next_escalation_at).toBeNull();

    // L3 event — chairperson named
    const events = emitted.filter((m) => m.topic === EVENTS.actionItemEscalated);
    expect(events[0].payload).toMatchObject({
      toLevel: 3,
      notify: "chairperson",
      notifyIds: [CHAIR],
    });

    // Notifications at L3: assignee + chairperson
    const notifs = emitted.filter((m) => m.topic === NOTIFICATION_SEND);
    expect(notifs.length).toBeGreaterThanOrEqual(2);
    const recipientIds = notifs.map((n) => (n.payload as any).recipientId ?? (n.payload as any).recipient);
    expect(recipientIds).toContain(CHAIR);
  });

  it("step 5: ATR generation includes the overdue/escalated item (Req 10.1, 10.4)", async () => {
    const { getATR } = await import("../src/modules/action-item/repo.js");

    const atr = await runWithTenant(TENANT, () => getATR(TENANT, COMMITTEE));

    // The report should include our action item
    expect(atr.entries.length).toBeGreaterThanOrEqual(1);
    const entry = atr.entries.find((e) => e.actionItemId === ACTION_ITEM_ID);
    expect(entry).toBeDefined();
    expect(entry!.currentStatus).toBe("escalated");
    expect(entry!.outcome).toBe("overdue");
    expect(entry!.daysOverdue).toBeGreaterThan(0);

    // ATR statistics
    expect(atr.statistics.overdue).toBeGreaterThanOrEqual(1);
    expect(atr.statistics.total).toBeGreaterThanOrEqual(1);
    expect(atr.statistics.compliancePct).toBe(0);
    expect(atr.belowComplianceFloor).toBe(true);

    // Per-assignee breakdown
    const assigneeRow = atr.perAssignee.find((a) => a.assigneeId === ASSIGNEE);
    expect(assigneeRow).toBeDefined();
    expect(assigneeRow!.overdue).toBeGreaterThanOrEqual(1);
  });

  it("step 6: no further escalation beyond Level 3 (top of chain)", async () => {
    const nowBeyondL3 = new Date(DEADLINE.getTime() + 500 * HOUR);
    const candidate = await buildCandidate();
    expect(candidate.escalationLevel).toBe(3);

    const result = await runActionItemEscalation({
      now: nowBeyondL3,
      loadCandidates: async () => [candidate],
      emit: async () => {
        throw new Error("should not emit — already at max escalation level");
      },
    });

    expect(result.scanned).toBe(1);
    expect(result.escalated).toBe(0);
    expect(result.failed).toBe(0);
  });
});
