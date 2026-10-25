import { describe, it, expect, afterEach, vi } from "vitest";
import { SYSTEM_TEMPLATE_IDS } from "@civitasone/events";
import { MemoryQueue } from "@civitasone/queue";
import {
  resolveDelegationRecipients, formatIstDate, formatPeriod, DELEGATION_CREATED, DELEGATION_REVOKED,
} from "../src/modules/domain-events/delegation-notice.js";

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: unknown) => Promise<void>) => { await fn({}); } },
  sqlClient: { end: vi.fn() },
}));
const outbox = vi.hoisted(() => ({ seen: new Set<string>(), sent: [] as Array<{ topic: string; payload: Record<string, unknown> }> }));
vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: async (_tx: unknown, id: string) => { if (outbox.seen.has(id)) return false; outbox.seen.add(id); return true; },
  enqueue: async (_tx: unknown, m: { topic: string; payload: Record<string, unknown> }) => { outbox.sent.push({ topic: m.topic, payload: m.payload }); },
}));
import { registerDomainEventConsumers } from "../src/modules/domain-events/consumer.js";

const ALICE = "11111111-1111-4111-8111-111111111111";
const MGR = "22222222-2222-4222-8222-222222222222";
const base = {
  id: "d1", delegatorId: ALICE, delegatorName: "Alice A", delegateId: "bob", delegateName: "Bob B",
  roles: ["estab_deputy_secretary", "estab_section_officer"], fromDate: "2026-11-01", toDate: "2026-11-15",
  occurredAt: "2026-10-25T20:00:00.000Z",
};
afterEach(() => { delete process.env.SMTP_HOST; outbox.sent.length = 0; outbox.seen.clear(); });

describe("delegation notice recipients", () => {
  it("notifies the delegator and the manager, with roles, delegate and IST dates", () => {
    const r = resolveDelegationRecipients(DELEGATION_CREATED, { ...base, managerId: MGR, managerName: "Meera M" });
    expect(r.map((x) => x.recipientId)).toEqual([ALICE, MGR]);
    expect(r[0]!.variables).toMatchObject({ headline: "You delegated", roles: "estab_deputy_secretary, estab_section_officer", delegateName: "Bob B", period: "01 Nov 2026 to 15 Nov 2026" });
    expect(r[1]!.variables.headline).toBe("Alice A delegated");
  });

  it("no manager found: only the delegator is notified", () => {
    const r = resolveDelegationRecipients(DELEGATION_CREATED, { ...base, managerId: null });
    expect(r.map((x) => x.recipientId)).toEqual([ALICE]);
  });

  it("a manager equal to the delegator is not notified twice", () => {
    expect(resolveDelegationRecipients(DELEGATION_CREATED, { ...base, managerId: ALICE })).toHaveLength(1);
  });

  it("revoke carries the revoke time in IST (20:00Z = 01:30 IST next day)", () => {
    const [r] = resolveDelegationRecipients(DELEGATION_REVOKED, { ...base, managerId: null });
    expect(r!.variables.occurredAt).toContain("26 Oct 2026");
    expect(r!.variables.occurredAt).toContain("01:30");
    expect(r!.variables.headline).toBe("You revoked");
  });

  it("plans an in-app notice only (no email: recipients are actor ids, not addresses)", () => {
    process.env.SMTP_HOST = "smtp.example.test";
    const s = resolveDelegationRecipients(DELEGATION_REVOKED, base)[0]!.sends;
    expect(s.map((x) => [x.channel, x.templateId])).toEqual([["in_app", SYSTEM_TEMPLATE_IDS.workflowDelegationRevoked]]);
  });

  it("a legacy {id}-only event (no delegator) yields no recipients", () => {
    expect(resolveDelegationRecipients(DELEGATION_REVOKED, { id: "x" })).toEqual([]);
  });

  it("formats open-ended ranges and date-only values in IST", () => {
    expect(formatIstDate("2026-11-01")).toBe("01 Nov 2026");
    expect(formatPeriod("2026-11-01", null)).toBe("from 01 Nov 2026 until revoked");
  });
});

describe("delegation notice consumer", () => {
  it("consumes workflow.delegation.created and enqueues one in-app notification.send per recipient, deduped by messageId", async () => {
    process.env.SMTP_HOST = "smtp.example.test";
    const q = new MemoryQueue();
    registerDomainEventConsumers(q);
    const env = { messageId: "33333333-3333-4333-8333-333333333333", type: DELEGATION_CREATED, tenantId: "44444444-4444-4444-8444-444444444444", actorId: ALICE, correlationId: "55555555-5555-4555-8555-555555555555", schemaVersion: "1.0", timestamp: new Date().toISOString(), payload: { ...base, managerId: MGR } };
    await q.publish(DELEGATION_CREATED, env);
    await new Promise((r) => setTimeout(r, 50));
    const sends = outbox.sent.filter((m) => m.topic === "notification.send").map((m) => m.payload);
    expect(sends).toHaveLength(2); // 2 recipients x in_app
    expect(sends.filter((p) => p.recipientId === MGR).map((p) => p.channel)).toEqual(["in_app"]);
    expect(sends.every((p) => p.eventType === DELEGATION_CREATED)).toBe(true);
    await q.publish(DELEGATION_CREATED, env); // redelivery
    await new Promise((r) => setTimeout(r, 50));
    expect(outbox.sent.filter((m) => m.topic === "notification.send")).toHaveLength(2);
  });
});
