/**
 * meeting-service — action-item escalation worker tests (Req 9.4, 9.5, 9.6).
 *
 * Covers the behaviours the scheduled worker is responsible for:
 *   • Escalation-level derivation — overdue items advance along the domain chain (Level 1 at
 *     deadline + 24h → supervisor, Level 2 at + 72h → department head, Level 3 at + 7d →
 *     chairperson), and only items whose level actually advances are acted on (monotonic, P20).
 *   • Recipient resolution — the chairperson is named directly at Level 3; the meeting secretary is
 *     the resolvable fallback for Levels 1–2 (the supervisor / department head is resolved
 *     downstream from the assignee via the event `notify` role).
 *   • Message construction — each escalation emits the canonical event + an assignee notification +
 *     one notification per named chain recipient + an audit fact.
 *   • Orchestration — scan → plan → apply runs exactly once per escalation and isolates per-item
 *     failures.
 *
 * The pure logic (`planEscalations`, `buildEscalationMessages`) is exercised directly; the runner
 * (`runActionItemEscalation`) is driven through in-memory ports so the full orchestration is
 * verified without a database.
 *
 * _Requirements: 9.4, 9.5, 9.6_
 */
import { describe, expect, it } from "vitest";
import {
  planEscalations,
  buildEscalationMessages,
  runActionItemEscalation,
  SYSTEM_ACTOR_ID,
  type EscalationCandidate,
  type EscalationAction,
} from "../src/workers/action-item-escalation.js";
import { EVENTS } from "../src/topics.js";
import { NOTIFICATION_SEND } from "@civitasone/events";

const HOUR = 3_600_000;
/** Fixed deadline anchor used across the suite (all `now` values are offsets from this). */
const DEADLINE = new Date("2026-06-15T00:00:00Z");
const CHAIR = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const SECRETARY = "55555555-5555-5555-5555-555555555555";
const ASSIGNEE = "99999999-9999-9999-9999-999999999999";

const candidate = (over: Partial<EscalationCandidate> = {}): EscalationCandidate => ({
  actionItemId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  tenantId: "tttttttt-tttt-tttt-tttt-tttttttttttt",
  meetingId: "mmmmmmmm-mmmm-mmmm-mmmm-mmmmmmmmmmmm",
  assigneeId: ASSIGNEE,
  deadline: DEADLINE,
  overdueAt: null,
  escalationLevel: 0,
  status: "overdue",
  version: 1,
  chairpersonId: CHAIR,
  secretaryId: SECRETARY,
  ...over,
});

/** `now` at `hours` past the fixed deadline. */
const at = (hours: number): Date => new Date(DEADLINE.getTime() + hours * HOUR);

describe("planEscalations — escalation-level derivation (Req 9.5, 9.6)", () => {
  it("escalates to Level 1 (supervisor) once the deadline + 24h has lapsed", () => {
    const [action] = planEscalations([candidate()], at(25));
    expect(action.fromLevel).toBe(0);
    expect(action.toLevel).toBe(1);
    expect(action.notify).toBe("supervisor");
  });

  it("escalates to Level 2 (department head) after the deadline + 72h", () => {
    const [action] = planEscalations([candidate()], at(73));
    expect(action.toLevel).toBe(2);
    expect(action.notify).toBe("department_head");
  });

  it("escalates to Level 3 (chairperson) after the deadline + 7d", () => {
    const [action] = planEscalations([candidate()], at(24 * 7 + 1));
    expect(action.toLevel).toBe(3);
    expect(action.notify).toBe("chairperson");
  });

  it("skips an item whose level does not advance (already at the derived level)", () => {
    // Already at Level 1, and only +25h has passed → computed level is also 1 → no advance.
    expect(planEscalations([candidate({ escalationLevel: 1 })], at(25))).toEqual([]);
  });

  it("never regresses the level below the item's current level (monotonic, P20)", () => {
    // Only +25h passed (computed L1) but the item is already at L2 → clamps to 2, no escalation.
    expect(planEscalations([candidate({ escalationLevel: 2 })], at(25))).toEqual([]);
  });

  it("skips settled items defensively (completed / verified / withdrawn)", () => {
    expect(planEscalations([candidate({ status: "completed" })], at(200))).toEqual([]);
    expect(planEscalations([candidate({ status: "verified" })], at(200))).toEqual([]);
    expect(planEscalations([candidate({ status: "withdrawn" })], at(200))).toEqual([]);
  });

  it("skips an item that is not yet overdue", () => {
    expect(planEscalations([candidate()], at(-1))).toEqual([]);
  });

  it("re-anchors the next escalation trigger to the following rung", () => {
    const [action] = planEscalations([candidate()], at(25));
    // Next rung after L1 is L2 at deadline + 72h.
    expect(action.nextEscalationAt?.getTime()).toBe(DEADLINE.getTime() + 72 * HOUR);
  });

  it("clears the next escalation trigger at the top of the chain (Level 3)", () => {
    const [action] = planEscalations([candidate()], at(24 * 7 + 1));
    expect(action.nextEscalationAt).toBeNull();
  });
});

describe("planEscalations — recipient resolution (Req 9.6)", () => {
  it("names the chairperson at Level 3", () => {
    const [action] = planEscalations([candidate()], at(24 * 7 + 1));
    expect(action.notifyIds).toEqual([CHAIR]);
  });

  it("names the meeting secretary as the resolvable recipient for Levels 1–2", () => {
    const [l1] = planEscalations([candidate()], at(25));
    expect(l1.notifyIds).toEqual([SECRETARY]);
    const [l2] = planEscalations([candidate()], at(73));
    expect(l2.notifyIds).toEqual([SECRETARY]);
  });

  it("falls back to the secretary at Level 3 when no chairperson is resolvable", () => {
    const [action] = planEscalations([candidate({ chairpersonId: null })], at(24 * 7 + 1));
    expect(action.notifyIds).toEqual([SECRETARY]);
  });

  it("names no recipient when neither chairperson nor secretary is resolvable", () => {
    const [action] = planEscalations(
      [candidate({ chairpersonId: null, secretaryId: null })],
      at(25),
    );
    expect(action.notifyIds).toEqual([]);
  });
});

describe("buildEscalationMessages — outbox fan-out (Req 9.5, 9.6, 16.2)", () => {
  const meta = { actorId: SYSTEM_ACTOR_ID, correlationId: "corr-1" };

  const action = (over: Partial<EscalationAction> = {}): EscalationAction => ({
    candidate: candidate(),
    fromLevel: 0,
    toLevel: 3,
    notify: "chairperson",
    notifyIds: [CHAIR],
    nextEscalationAt: null,
    ...over,
  });

  it("emits the canonical escalation event with the notify role + recipient ids", () => {
    const messages = buildEscalationMessages(action(), meta);
    const event = messages.find((m) => m.topic === EVENTS.actionItemEscalated);
    expect(event).toBeDefined();
    expect(event?.payload).toMatchObject({
      actionItemId: candidate().actionItemId,
      meetingId: candidate().meetingId,
      assigneeId: ASSIGNEE,
      toLevel: 3,
      notify: "chairperson",
      notifyIds: [CHAIR],
    });
  });

  it("notifies the assignee and each named chain recipient", () => {
    const notifications = buildEscalationMessages(action(), meta).filter(
      (m) => m.topic === NOTIFICATION_SEND,
    );
    // One for the assignee, one for the chairperson.
    expect(notifications).toHaveLength(2);
  });

  it("emits exactly one audit fact carrying the level transition", () => {
    const audits = buildEscalationMessages(action({ fromLevel: 1, toLevel: 2 }), meta).filter(
      (m) => m.topic === "audit.event.record",
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]?.payload).toMatchObject({
      action: "escalate",
      resourceType: "action_item",
      metadata: { fromLevel: 1, toLevel: 2 },
    });
  });

  it("stamps every message with the tenant, system actor, and correlation id", () => {
    const messages = buildEscalationMessages(action(), meta);
    for (const m of messages) {
      expect(m.tenantId).toBe(candidate().tenantId);
      expect(m.actorId).toBe(SYSTEM_ACTOR_ID);
      expect(m.correlationId).toBe("corr-1");
    }
  });

  it("omits chain-recipient notifications when no recipient is named", () => {
    const notifications = buildEscalationMessages(
      action({ notify: "supervisor", notifyIds: [] }),
      meta,
    ).filter((m) => m.topic === NOTIFICATION_SEND);
    // Only the assignee is notified.
    expect(notifications).toHaveLength(1);
  });
});

describe("runActionItemEscalation — scan → plan → apply orchestration (Req 9.4)", () => {
  it("applies each due escalation exactly once and passes the fired now to the scan", async () => {
    const now = at(73); // both items are past their L1 window; escalate
    const scanned = [
      candidate({ actionItemId: "item-a" }),
      candidate({ actionItemId: "item-b", escalationLevel: 1 }),
    ];

    const applied: string[] = [];
    let scanNow: Date | undefined;

    const result = await runActionItemEscalation({
      now,
      loadCandidates: async (n) => {
        scanNow = n;
        return scanned;
      },
      emit: async (action) => {
        applied.push(action.candidate.actionItemId);
      },
    });

    expect(scanNow).toBe(now);
    // item-a: 0→2, item-b: 1→2 — both advance.
    expect(applied.sort()).toEqual(["item-a", "item-b"]);
    expect(result).toEqual({ scanned: 2, escalated: 2, failed: 0 });
  });

  it("does not act on candidates whose level does not advance", async () => {
    const result = await runActionItemEscalation({
      now: at(25),
      // Already at L1; +25h still computes L1 → no advance.
      loadCandidates: async () => [candidate({ escalationLevel: 1 })],
      emit: async () => {
        throw new Error("should not emit");
      },
    });
    expect(result).toEqual({ scanned: 1, escalated: 0, failed: 0 });
  });

  it("isolates a per-item failure and keeps processing the rest", async () => {
    const now = at(73);
    const scanned = [
      candidate({ actionItemId: "bad" }),
      candidate({ actionItemId: "good" }),
    ];

    const applied: string[] = [];
    const result = await runActionItemEscalation({
      now,
      loadCandidates: async () => scanned,
      emit: async (action) => {
        if (action.candidate.actionItemId === "bad") throw new Error("version conflict");
        applied.push(action.candidate.actionItemId);
      },
      logger: { error: () => {}, info: () => {}, warn: () => {} } as never,
    });

    expect(applied).toEqual(["good"]);
    expect(result).toEqual({ scanned: 2, escalated: 1, failed: 1 });
  });

  it("reports an empty sweep when there are no candidates", async () => {
    const result = await runActionItemEscalation({
      now: at(100),
      loadCandidates: async () => [],
      emit: async () => {
        throw new Error("should not emit");
      },
    });
    expect(result).toEqual({ scanned: 0, escalated: 0, failed: 0 });
  });
});
