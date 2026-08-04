import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normaliseRules,
  normaliseLog,
  normaliseResources,
  normaliseAgents,
  normaliseEscalationRules,
  minutesSince,
  formatAgeing,
  ageingFromLog,
  RULE_TYPES,
  getAssignmentRules,
  assignLead,
  acceptLead,
  transferOwnership,
  updateAgentCapacity,
  deleteEscalationRule,
  type AssignmentLogEntry,
} from "@/lib/crm/assignment";
import * as browser from "@/lib/api/browserClient";

vi.mock("@/lib/api/browserClient", async (orig) => {
  const actual = await orig<typeof import("@/lib/api/browserClient")>();
  return { ...actual, browserFetch: vi.fn() };
});
const fetchMock = vi.mocked(browser.browserFetch);
function res(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body, clone() { return this; } } as unknown as Response;
}
beforeEach(() => fetchMock.mockReset());

describe("assignment normalisers", () => {
  it("normaliseRules tolerates bare array and {items}/{data} wrappers + bad rows", () => {
    const raw = [
      { id: "r1", name: "West", ruleType: "territory", criteria: { region: "w" }, ordinal: 0, enabled: false, fallbackOwnerId: "u1" },
      { name: "", ruleType: "x" }, // dropped: no name
      { name: "Bad type", ruleType: "nope" }, // coerced to territory
      "junk",
    ];
    const bare = normaliseRules(raw);
    expect(bare).toHaveLength(2);
    expect(bare[0]).toMatchObject({ id: "r1", ruleType: "territory", enabled: false, ordinal: 0 });
    expect(bare[1].ruleType).toBe("territory");
    expect(normaliseRules({ items: raw })).toHaveLength(2);
    expect(normaliseRules({ data: raw })).toHaveLength(2);
    expect(normaliseRules({ rules: raw })).toHaveLength(2);
    expect(normaliseRules(null)).toEqual([]);
  });

  it("normaliseRules defaults criteria to {} when not an object", () => {
    expect(normaliseRules([{ name: "A", criteria: [1, 2] }])[0].criteria).toEqual({});
    expect(normaliseRules([{ name: "A" }])[0].enabled).toBe(true);
    expect(RULE_TYPES).toContain("round_robin");
  });

  it("normaliseLog coerces method and carries acceptedAt", () => {
    const log = normaliseLog([
      { ownerId: "u1", ruleId: "r1", method: "auto", assignedAt: "t", assignedBy: "sys", acceptedAt: "t2" },
      { ownerId: "u2", method: "weird" },
    ]);
    expect(log[0]).toMatchObject({ method: "auto", acceptedAt: "t2" });
    expect(log[1].method).toBe("manual");
    expect(log[1]).not.toHaveProperty("acceptedAt");
    expect(normaliseLog({ log: [] })).toEqual([]);
  });

  it("normaliseResources drops nameless rows", () => {
    expect(normaliseResources([{ name: "Q1" }, { description: "x" }])).toHaveLength(1);
  });

  it("normaliseAgents reads id/agentId + activeLeads aliases", () => {
    const a = normaliseAgents([
      { agentId: "a1", name: "Asha", currentLeads: 5, maxLeads: 10 },
      { id: "a2", openLeads: 3 },
      { name: "no id" },
    ]);
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({ agentId: "a1", activeLeads: 5, available: true });
    expect(a[1]).toMatchObject({ agentId: "a2", activeLeads: 3, name: "a2" });
  });

  it("normaliseEscalationRules coerces trigger", () => {
    const r = normaliseEscalationRules([{ trigger: "unattended", thresholdMinutes: 30 }, { trigger: "x" }]);
    expect(r[0].trigger).toBe("unattended");
    expect(r[1].trigger).toBe("unaccepted");
  });
});

describe("ageing helpers", () => {
  const NOW = Date.parse("2026-08-04T12:00:00Z");
  it("minutesSince computes whole minutes, floors at 0, tolerates junk", () => {
    expect(minutesSince("2026-08-04T11:00:00Z", NOW)).toBe(60);
    expect(minutesSince("2026-08-04T13:00:00Z", NOW)).toBe(0);
    expect(minutesSince("nonsense", NOW)).toBe(0);
  });
  it("formatAgeing renders compact d/h/m", () => {
    expect(formatAgeing(0)).toBe("just now");
    expect(formatAgeing(5)).toBe("5m");
    expect(formatAgeing(75)).toBe("1h 15m");
    expect(formatAgeing(1500)).toBe("1d 1h");
  });
  it("ageingFromLog derives latest + pendingAcceptance", () => {
    const log: AssignmentLogEntry[] = [
      { ownerId: "u1", ruleId: "", method: "manual", assignedAt: "2026-08-04T11:00:00Z", assignedBy: "s" },
    ];
    const a = ageingFromLog(log, NOW);
    expect(a.minutesSinceAssigned).toBe(60);
    expect(a.pendingAcceptance).toBe(true);
    expect(ageingFromLog([], NOW)).toMatchObject({ latest: null, pendingAcceptance: false });
    const accepted = ageingFromLog([{ ...log[0], acceptedAt: "x" }], NOW);
    expect(accepted.pendingAcceptance).toBe(false);
  });
});

describe("assignment client calls", () => {
  it("getAssignmentRules returns error source on !ok and on throw", async () => {
    fetchMock.mockResolvedValueOnce(res({}, 500));
    expect((await getAssignmentRules()).source).toBe("error");
    fetchMock.mockRejectedValueOnce(new Error("net"));
    expect((await getAssignmentRules()).source).toBe("error");
  });
  it("assignLead flags 202 as accepted, 200 as sync", async () => {
    fetchMock.mockResolvedValueOnce(res({}, 202));
    expect((await assignLead("l1", { runRules: true })).accepted).toBe(true);
    fetchMock.mockResolvedValueOnce(res({}, 200));
    expect((await assignLead("l1", { ownerId: "u1" })).accepted).toBe(false);
  });
  it("acceptLead/transferOwnership post to the right paths", async () => {
    fetchMock.mockResolvedValueOnce(res({}, 200));
    await acceptLead("l9");
    expect(fetchMock.mock.calls[0][0]).toBe("v1/crm/leads/l9/accept");
    fetchMock.mockResolvedValueOnce(res({}, 200));
    await transferOwnership("c1", "u2", "reorg");
    expect(fetchMock.mock.calls[1][0]).toBe("v1/crm/contacts/c1/transfer");
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({ toOwnerId: "u2", reason: "reorg" });
  });
  it("updateAgentCapacity PUTs capacity; delete throws surfaced message on !ok", async () => {
    fetchMock.mockResolvedValueOnce(res({}, 200));
    await updateAgentCapacity("a1", { maxLeads: 5, available: true, onLeave: false });
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("PATCH");
    fetchMock.mockResolvedValueOnce(res({ code: "BOOM", message: "no" }, 400));
    await expect(deleteEscalationRule("e1")).rejects.toThrow(/BOOM/);
  });
});

describe("assignment CRUD wrappers (paths, methods, error propagation)", () => {
  it("assignment-rule create/update/delete hit the right verbs and paths", async () => {
    const { createAssignmentRule, updateAssignmentRule, deleteAssignmentRule } = await import("@/lib/crm/assignment");
    const rule = { name: "R", ruleType: "territory" as const, criteria: {}, ordinal: 0, enabled: true, fallbackOwnerId: "" };
    fetchMock.mockResolvedValueOnce(res({}, 200));
    await createAssignmentRule(rule);
    expect(fetchMock.mock.calls[0][0]).toBe("v1/crm/assignment-rules");
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe("POST");
    fetchMock.mockResolvedValueOnce(res({}, 200));
    await updateAssignmentRule("r1", rule);
    expect(fetchMock.mock.calls[1][0]).toBe("v1/crm/assignment-rules/r1");
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe("PUT");
    fetchMock.mockResolvedValueOnce(res({}, 200));
    await deleteAssignmentRule("r1");
    expect((fetchMock.mock.calls[2][1] as RequestInit).method).toBe("DELETE");
    fetchMock.mockResolvedValueOnce(res({ code: "X", message: "y" }, 500));
    await expect(createAssignmentRule(rule)).rejects.toThrow(/X/);
  });

  it("assignment-log loader returns api data and error source", async () => {
    const { getAssignmentLog } = await import("@/lib/crm/assignment");
    fetchMock.mockResolvedValueOnce(res([{ ownerId: "u1", method: "manual" }], 200));
    const ok = await getAssignmentLog("l1");
    expect(ok.source).toBe("api");
    expect(ok.data).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(res({}, 500));
    expect((await getAssignmentLog("l1")).source).toBe("error");
    fetchMock.mockRejectedValueOnce(new Error("net"));
    expect((await getAssignmentLog("l1")).source).toBe("error");
  });

  it("ownership resources: get (ok/error/throw) + create/update/delete paths", async () => {
    const { getResources, createResource, updateResource, deleteResource } = await import("@/lib/crm/assignment");
    fetchMock.mockResolvedValueOnce(res([{ name: "Q" }], 200));
    expect((await getResources("assignment-queues")).source).toBe("api");
    fetchMock.mockResolvedValueOnce(res({}, 500));
    expect((await getResources("territories")).source).toBe("error");
    fetchMock.mockRejectedValueOnce(new Error("net"));
    expect((await getResources("partners")).source).toBe("error");
    const body = { name: "Q", description: "", enabled: true };
    fetchMock.mockResolvedValueOnce(res({}, 200));
    await createResource("branches", body);
    expect(fetchMock.mock.calls.at(-1)![0]).toBe("v1/crm/branches");
    fetchMock.mockResolvedValueOnce(res({}, 200));
    await updateResource("branches", "b1", body);
    expect(fetchMock.mock.calls.at(-1)![0]).toBe("v1/crm/branches/b1");
    fetchMock.mockResolvedValueOnce(res({}, 200));
    await deleteResource("branches", "b1");
    expect((fetchMock.mock.calls.at(-1)![1] as RequestInit).method).toBe("DELETE");
    fetchMock.mockResolvedValueOnce(res({ code: "E", message: "m" }, 400));
    await expect(createResource("branches", body)).rejects.toThrow(/E/);
  });

  it("agents loader (ok/error) + capacity error propagation", async () => {
    const { getAgents, updateAgentCapacity } = await import("@/lib/crm/assignment");
    fetchMock.mockResolvedValueOnce(res({ agents: [{ agentId: "a1", maxLeads: 5 }] }, 200));
    expect((await getAgents()).data).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(res({}, 500));
    expect((await getAgents()).source).toBe("error");
    fetchMock.mockRejectedValueOnce(new Error("net"));
    expect((await getAgents()).source).toBe("error");
    fetchMock.mockResolvedValueOnce(res({ code: "CAP", message: "bad" }, 422));
    await expect(updateAgentCapacity("a1", { maxLeads: 1, available: true, onLeave: false })).rejects.toThrow(/CAP/);
  });

  it("escalation rules: get (ok/error) + create/update paths + accept path", async () => {
    const { getEscalationRules, createEscalationRule, updateEscalationRule, acceptLead } = await import("@/lib/crm/assignment");
    fetchMock.mockResolvedValueOnce(res([{ trigger: "unaccepted", thresholdMinutes: 10 }], 200));
    expect((await getEscalationRules()).data).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(res({}, 500));
    expect((await getEscalationRules()).source).toBe("error");
    fetchMock.mockRejectedValueOnce(new Error("net"));
    expect((await getEscalationRules()).source).toBe("error");
    const er = { trigger: "unaccepted" as const, thresholdMinutes: 10, recipientRole: "r", recipientId: "", reassign: false, enabled: true };
    fetchMock.mockResolvedValueOnce(res({}, 200));
    await createEscalationRule(er);
    expect(fetchMock.mock.calls.at(-1)![0]).toBe("v1/crm/escalation-rules");
    fetchMock.mockResolvedValueOnce(res({}, 200));
    await updateEscalationRule("e1", er);
    expect(fetchMock.mock.calls.at(-1)![0]).toBe("v1/crm/escalation-rules/e1");
    fetchMock.mockResolvedValueOnce(res({}, 202));
    expect((await acceptLead("l1")).accepted).toBe(true);
  });
});
