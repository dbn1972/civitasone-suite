import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  normaliseActivities,
  normaliseCommunications,
  normaliseAddresses,
  normaliseContactRoles,
  normaliseRelationships,
  normaliseTaskEscalationRules,
  normaliseOverdueTasks,
  normaliseEscalationRoles,
  normaliseEscalationUsers,
  normaliseLinkedAccounts,
  normalise360,
  getActivities,
  createActivity,
  getCommunications,
  createCommunication,
  getAddresses,
  createAddress,
  getContactRoles,
  createContactRole,
  getAccountRelationships,
  getTaskEscalationRules,
  createTaskEscalationRule,
  updateTaskEscalationRule,
  taskEscalationRuleBody,
  TaskEscalationRuleRejected,
  getOverdueTaskPage,
  getOverdueMatchCount,
  snoozeTask,
  reassignTask,
  getEscalationRoles,
  getEscalationUsers,
  getLinkedAccounts,
  connectLinkedAccount,
  getContact360,
  getAccount360,
  ACTIVITY_TYPES,
  CONTACT_ROLES,
} from "@/lib/crm/activityAccount";
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

describe("normalisers", () => {
  it("normaliseActivities: tolerates {activities}, sorts newest-first, drops no-id, dueAt||dueDate", () => {
    const out = normaliseActivities({
      activities: [
        { id: "a1", type: "call", subject: "old", createdAt: "2026-01-01T00:00:00Z", dueDate: "2026-02-02" },
        { id: "a2", type: "meeting", subject: "new", createdAt: "2026-05-01T00:00:00Z", dueAt: "2026-05-02T10:00:00Z", location: "HQ", subjectType: "contact", subjectId: "c9" },
        { type: "note" }, // dropped: no id
        "junk",
      ],
    });
    expect(out.map((a) => a.id)).toEqual(["a2", "a1"]);
    expect(out[0].location).toBe("HQ");
    expect(out[0].subjectType).toBe("contact");
    expect(out[0].subjectId).toBe("c9");
    expect(out[1].dueAt).toBe("2026-02-02");
  });

  it("normaliseCommunications: bare array + defaults + summary||text, newest-first", () => {
    const out = normaliseCommunications([
      { id: "c1", occurredAt: "2026-01-01T00:00:00Z", text: "hi" },
      { id: "c2", direction: "inbound", channel: "whatsapp", occurredAt: "2026-03-01T00:00:00Z", summary: "later" },
    ]);
    expect(out[0].id).toBe("c2");
    expect(out[0].channel).toBe("whatsapp");
    expect(out[1].summary).toBe("hi");
    expect(out[1].direction).toBe("outbound");
  });

  it("normaliseCommunication: contact cross-service items date off sentAt fallback", () => {
    // Cross-service `communicationItems` only carry `sentAt` (no occurredAt/createdAt).
    const out = normaliseCommunications([{ id: "ci1", channel: "email", sentAt: "2026-04-01T09:00:00Z" }]);
    expect(out).toHaveLength(1);
    expect(out[0].occurredAt).toBe("2026-04-01T09:00:00Z");
  });

  it("normaliseAddresses: coerces owner/type, defaults country India", () => {
    const out = normaliseAddresses([
      { id: "ad1", ownerType: "account", addressType: "billing", line1: "1 Rd", city: "Pune", pincode: "411001" },
      { addressType: "weird", line1: "x" },
    ]);
    expect(out[0].ownerType).toBe("account");
    expect(out[0].country).toBe("India");
    expect(out[1].addressType).toBe("other");
    expect(out[1].ownerType).toBe("contact");
  });

  it("normaliseContactRoles: from {data}, drops no-id", () => {
    const out = normaliseContactRoles({ data: [{ id: "r1", role: "beneficiary", dealId: "d1" }, { role: "x" }] });
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("beneficiary");
  });

  it("normaliseRelationships: coerces relType, drops no-toAccountId", () => {
    const out = normaliseRelationships([
      { id: "x1", toAccountId: "acc2", relType: "subsidiary", toAccountName: "Sub Ltd" },
      { id: "x2", toAccountId: "acc3", relType: "nonsense" },
      { relType: "parent" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].toAccountName).toBe("Sub Ltd");
    expect(out[1].relType).toBe("affiliate");
  });

  it("normaliseTaskEscalationRules: threshold coercion + enabled default", () => {
    const out = normaliseTaskEscalationRules([{ id: "e1", thresholdMinutes: "120", managerRole: "mgr" }]);
    expect(out[0].thresholdMinutes).toBe(120);
    expect(out[0].enabled).toBe(true);
  });

  // GAP-CRM-TASK-ESCALATION-01: crm-service stores the manager as recipientRole /
  // recipientId. The editor only read managerRole / managerId, so a saved manager
  // never came back and every rule looked like it had none.
  it("normaliseTaskEscalationRules reads the manager from crm-service's recipientRole / recipientId, plus name and appliesTo", () => {
    const out = normaliseTaskEscalationRules({
      data: [
        { id: "e1", name: "After a day", appliesTo: "task", thresholdMinutes: 1440, recipientRole: "sales_manager", recipientId: null, enabled: true },
        { id: "e2", name: "Then the head", appliesTo: "both", thresholdMinutes: 2880, recipientRole: null, recipientId: "u-9", enabled: false },
        { id: "e3", thresholdMinutes: 60, appliesTo: "nonsense", managerRole: "legacy_role", managerId: "legacy-id" },
      ],
    });
    expect(out[0]).toMatchObject({ name: "After a day", appliesTo: "task", managerRole: "sales_manager", managerId: "" });
    expect(out[1]).toMatchObject({ managerRole: "", managerId: "u-9", enabled: false });
    // The legacy field names are still accepted; an unknown appliesTo is dropped, not trusted.
    expect(out[2]).toMatchObject({ managerRole: "legacy_role", managerId: "legacy-id" });
    expect(out[2].appliesTo).toBeUndefined();
  });

  it("taskEscalationRuleBody sends the shape crm-service accepts (name, recipientRole/recipientId), not the editor's own", () => {
    expect(
      taskEscalationRuleBody({ name: "  After a day ", thresholdMinutes: 1440, managerRole: " sales_manager ", managerId: "", enabled: true }),
    ).toEqual({ name: "After a day", appliesTo: "both", thresholdMinutes: 1440, recipientRole: "sales_manager", recipientId: null, enabled: true });
    expect(
      taskEscalationRuleBody({ name: "x", appliesTo: "task", thresholdMinutes: 60, managerRole: "", managerId: "u-1", enabled: false }),
    ).toEqual({ name: "x", appliesTo: "task", thresholdMinutes: 60, recipientRole: null, recipientId: "u-1", enabled: false });
  });

  it("normaliseOverdueTasks: drops future/non-task, ages + sorts worst-first", () => {
    const now = Date.parse("2026-08-04T12:00:00Z");
    const out = normaliseOverdueTasks(
      {
        activities: [
          { id: "t1", type: "task", status: "open", subject: "a", dueAt: "2026-08-04T11:00:00Z" }, // 60m
          { id: "t2", type: "task", status: "open", subject: "b", dueAt: "2026-08-03T12:00:00Z" }, // 1440m
          { id: "t3", type: "task", status: "open", subject: "future", dueAt: "2026-08-05T12:00:00Z" }, // dropped
          { id: "t4", type: "call", status: "open", dueAt: "2026-01-01T00:00:00Z" }, // dropped: not task
        ],
      },
      now,
    );
    expect(out.map((t) => t.id)).toEqual(["t2", "t1"]);
    expect(out[0].ageMinutes).toBe(1440);
  });

  // GAP-CRM-TASK-ESCALATION-02 (IDLEAK): `owner` is a display name ONLY. An
  // opaque owner id must land on `ownerId`, never on `owner` — the old code did
  // owner ?? actorName ?? ownerId, leaking a UUID into the rendered Owner cell.
  // GAP-CRM-TASK-ESCALATION-02: crm-service now resolves the owner NAME server-side (ownerName).
  it("normaliseOverdueTasks takes the display name from the server's ownerName", () => {
    const now = Date.parse("2026-08-04T12:00:00Z");
    const [t] = normaliseOverdueTasks(
      { data: [{ id: "t1", type: "task", status: "open", subject: "named", dueDate: "2026-08-01", ownerName: "Kavita Rao", ownerId: "uuid-1" }] },
      now,
    );
    expect(t.owner).toBe("Kavita Rao");
    expect(t.ownerId).toBe("uuid-1");
  });

  it("normaliseOverdueTasks keeps an opaque owner id out of the display `owner`", () => {
    const now = Date.parse("2026-08-04T12:00:00Z");
    const out = normaliseOverdueTasks(
      {
        activities: [
          { id: "t1", type: "task", status: "open", subject: "named", dueAt: "2026-08-03T10:00:00Z", actorName: "Priya Nair", ownerId: "uuid-1" },
          { id: "t2", type: "task", status: "open", subject: "id only", dueAt: "2026-08-03T11:00:00Z", ownerId: "9f1c0b2a-1111-2222-3333-444455556666" },
        ],
      },
      now,
    );
    const named = out.find((t) => t.id === "t1")!;
    const idOnly = out.find((t) => t.id === "t2")!;
    // Named task: display name from actorName, id preserved separately.
    expect(named.owner).toBe("Priya Nair");
    expect(named.ownerId).toBe("uuid-1");
    // Id-only task: NO display name (so the UI never prints the id as a name).
    expect(idOnly.owner).toBeUndefined();
    expect(idOnly.ownerId).toBe("9f1c0b2a-1111-2222-3333-444455556666");
  });

  // GAP-CRM-TASK-ESCALATION-01 — role/user directory normalisers for the picker.
  it("normaliseEscalationRoles reads key+label and tolerates a {roles} wrapper", () => {
    const out = normaliseEscalationRoles({
      roles: [
        { key: "sales_manager", label: "Sales Manager" },
        { name: "ops_manager" },
        { nope: true },
      ],
    });
    expect(out).toEqual([
      { key: "sales_manager", label: "Sales Manager" },
      { key: "ops_manager", label: "ops_manager" },
    ]);
  });

  it("normaliseEscalationUsers keeps the id and a name (never drops the id)", () => {
    const out = normaliseEscalationUsers({
      users: [
        { id: "u-1", name: "Priya Nair" },
        { id: "u-2", email: "arjun@gov.in" },
        { name: "no id" },
      ],
    });
    expect(out).toEqual([
      { id: "u-1", name: "Priya Nair" },
      { id: "u-2", name: "arjun@gov.in" },
    ]);
  });

  it("normaliseLinkedAccounts: drops unknown provider, coerces status", () => {
    const out = normaliseLinkedAccounts([
      { id: "l1", provider: "google", externalEmail: "a@b.com", status: "connected" },
      { id: "l2", provider: "google", externalEmail: "c@d.com", status: "weird" },
      { id: "l3", provider: "facebook", externalEmail: "x@y.com" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].status).toBe("connected");
    expect(out[1].status).toBe("pending");
  });

  it("normalise360: nested collections + honest external null counts", () => {
    const v = normalise360({
      activities: [{ id: "a1", createdAt: "2026-01-01T00:00:00Z" }],
      // Contact shape: cross-service message items live under `communicationItems`.
      communicationItems: { items: [{ id: "c1", occurredAt: "2026-01-01T00:00:00Z" }], total: 1, available: true },
      // NEW real counts blocks (source:'crm'), BRD §9.4.
      communications: { total: 9, delivered: 7, failed: 2, source: "crm" },
      campaignActivity: { responses: 4, conversions: 1, revenueMinor: "1234567", source: "crm" },
      deals: [{ id: "d1", name: "Deal", stage: "won", amount: 5000 }],
      quotations: [{ id: "q1", reference: "Q-1", status: "sent", total: 100 }],
      nextActions: [{ id: "n1", title: "call", status: "open", dueDate: "2026-02-02" }],
      roles: [{ id: "r1", role: "champion", dealId: "d1" }],
      addresses: [{ id: "ad1", addressType: "office", line1: "1", city: "X", pincode: "111111" }],
      consent: { marketing: true, updatedAt: "2026-01-01T00:00:00Z" },
      score: 72,
      // Real backend NESTED external shape; non-null counts must render (not "—").
      external: {
        helpdeskCases: { count: 3, source: "external" },
        knowledgeDocuments: { count: 5, source: "external" },
      },
    });
    expect(v.deals[0].amount).toBe(5000);
    expect(v.quotations[0].amount).toBe(100);
    expect(v.nextActions[0].dueAt).toBe("2026-02-02");
    expect(v.consent?.marketing).toBe(true);
    expect(v.score).toBe(72);
    // Nested `.count` is read (guards against the latent flat-field drift).
    expect(v.external.caseCount).toBe(3);
    expect(v.external.documentCount).toBe(5);
    expect(v.external.source).toBe("external");
    // Renamed contact item list ({ items } wrapper) still parses.
    expect(v.communicationItems).toHaveLength(1);
    expect(v.communicationItems[0].id).toBe("c1");
    // NEW real communication counts block.
    expect(v.communications).toEqual({ total: 9, delivered: 7, failed: 2, source: "crm" });
    // NEW real campaign-activity block; revenue stays a paise string.
    expect(v.campaignActivity).toEqual({ responses: 4, conversions: 1, revenueMinor: "1234567", source: "crm" });
  });

  it("normalise360: account localCommunications array feeds communicationItems", () => {
    const v = normalise360({
      localCommunications: [
        { id: "lc1", occurredAt: "2026-01-02T00:00:00Z" },
        { id: "lc2", occurredAt: "2026-01-01T00:00:00Z" },
      ],
      communications: { total: 0, delivered: 0, failed: 0, source: "crm" },
      campaignActivity: { responses: 0, conversions: 0, revenueMinor: "0", source: "crm" },
    });
    expect(v.communicationItems).toHaveLength(2);
    // A source:'crm' block with zeros is a REAL zero, not an error/stub.
    expect(v.communications.source).toBe("crm");
    expect(v.communications.total).toBe(0);
    expect(v.campaignActivity.source).toBe("crm");
    expect(v.campaignActivity.revenueMinor).toBe("0");
  });

  it("normalise360: missing/garbled §9.4 blocks collapse to source:'error' + safe 0s", () => {
    const v = normalise360({ communications: { total: "x" }, campaignActivity: { revenueMinor: "12.3abc" } });
    expect(v.communications).toEqual({ total: 0, delivered: 0, failed: 0, source: "error" });
    // A non-integer revenue string is rejected to a real "0" (never NaN/float).
    expect(v.campaignActivity).toEqual({ responses: 0, conversions: 0, revenueMinor: "0", source: "error" });
  });

  it("normalise360: empty input yields safe defaults + external stub", () => {
    const v = normalise360(null);
    expect(v.activities).toEqual([]);
    expect(v.communicationItems).toEqual([]);
    expect(v.score).toBeNull();
    expect(v.consent).toBeNull();
    expect(v.external.source).toBe("external");
    // No block present ⇒ source:'error' (the panel gates, never shows a fake 0).
    expect(v.communications.source).toBe("error");
    expect(v.campaignActivity.source).toBe("error");
  });

  it("constants expose the expanded vocabularies", () => {
    expect(ACTIVITY_TYPES).toContain("appointment");
    expect(ACTIVITY_TYPES).toContain("reminder");
    expect(CONTACT_ROLES).toEqual(expect.arrayContaining(["beneficiary", "partner", "billing_contact"]));
  });
});

describe("loaders + mutations", () => {
  it("getActivities returns api on ok, error on failure", async () => {
    fetchMock.mockResolvedValueOnce(res({ data: [{ id: "a1", createdAt: "2026-01-01T00:00:00Z" }] }));
    expect((await getActivities("contact", "c1")).source).toBe("api");
    // AC-001: the GET is scoped to the record (subjectType + subjectId) — lock the contract.
    expect(fetchMock.mock.calls[0][0]).toContain("subjectType=contact");
    expect(fetchMock.mock.calls[0][0]).toContain("subjectId=c1");
    fetchMock.mockResolvedValueOnce(res({}, 500));
    expect((await getActivities("contact", "c1")).source).toBe("error");
    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect((await getActivities("contact", "c1")).source).toBe("error");
  });

  it("createActivity maps contact->contactId + dueAt->dueDate and flags 202", async () => {
    fetchMock.mockResolvedValueOnce(res({}, 202));
    const r = await createActivity({ type: "task", subjectType: "contact", subjectId: "c1", text: "do it", dueAt: "2026-05-02T10:00:00Z" });
    expect(r.accepted).toBe(true);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.contactId).toBe("c1");
    expect(body.dueDate).toBe("2026-05-02");
    expect(body.dueAt).toBe("2026-05-02T10:00:00Z");
  });

  it("createActivity maps deal->dealId and throws a clerk-safe message on failure, never the server's raw code/message (UX-020)", async () => {
    fetchMock.mockResolvedValueOnce(res({}, 200));
    await createActivity({ type: "note", subjectType: "deal", subjectId: "d1", text: "hi" });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.dealId).toBe("d1");
    fetchMock.mockResolvedValueOnce(res({ code: "BAD", message: "no" }, 400));
    await expect(createActivity({ type: "note", subjectType: "contact", subjectId: "c1", text: "x" })).rejects.toThrow("Some details weren't accepted. Check what you entered and try again.");
    fetchMock.mockResolvedValueOnce(res({ code: "BAD", message: "no" }, 400));
    await expect(createActivity({ type: "note", subjectType: "contact", subjectId: "c1", text: "x" })).rejects.not.toThrow(/BAD/);
  });

  it("communications, addresses, roles, relationships, escalation, overdue, linked loaders gate errors", async () => {
    for (const loader of [
      () => getCommunications("contact", "c1"),
      () => getAddresses("contact", "c1"),
      () => getContactRoles("c1"),
      () => getAccountRelationships("a1"),
      () => getTaskEscalationRules(),
      () => getOverdueTaskPage(),
      () => getLinkedAccounts(),
    ]) {
      fetchMock.mockResolvedValueOnce(res([], 200));
      expect((await loader()).source).toBe("api");
      fetchMock.mockResolvedValueOnce(res({}, 500));
      expect((await loader()).source).toBe("error");
    }
  });

  // GAP-CRM-TASK-ESCALATION-01 — the pickers come from crm-service's own directory (CRM roles),
  // not the platform-admin-only policy/roles and identity/users listings.
  it("getEscalationRoles / getEscalationUsers hit crm-service's directory endpoints and gate errors", async () => {
    fetchMock.mockResolvedValueOnce(res({ data: [{ key: "sales_manager", label: "Sales Manager" }] }));
    const roles = await getEscalationRoles();
    expect(fetchMock.mock.calls[0][0]).toBe("v1/crm/directory/roles");
    expect(roles.data).toHaveLength(1);

    fetchMock.mockResolvedValueOnce(res({ data: [{ id: "u-1", name: "Priya Nair" }] }));
    const users = await getEscalationUsers();
    expect(fetchMock.mock.calls[1][0]).toBe("v1/crm/directory/users");
    expect(users.data[0].id).toBe("u-1");

    fetchMock.mockResolvedValueOnce(res({}, 500));
    expect((await getEscalationRoles()).source).toBe("error");
    fetchMock.mockResolvedValueOnce(res({}, 503));
    expect((await getEscalationUsers()).source).toBe("error");
  });

  // GAP-CRM-TASK-ESCALATION-02 — the monitor pages through the real backlog.
  it("getOverdueTaskPage asks the server for the page the reader is on and reports the REAL total", async () => {
    fetchMock.mockResolvedValueOnce(
      res({
        data: [{ id: "t1", type: "task", status: "open", subject: "a", dueDate: "2020-01-01", ownerId: "u1", ownerName: "Kavita Rao" }],
        meta: { total: 214, limit: 50, offset: 100 },
      }),
    );
    const page = await getOverdueTaskPage({ limit: 50, offset: 100 });
    // GAP-CRM-TASK-ESCALATION-06: the dedicated overdue-tasks route (the old subject-less
    // /v1/crm/activities query 400s server-side).
    expect(fetchMock.mock.calls[0][0]).toBe("v1/crm/activities/overdue-tasks?limit=50&offset=100");
    expect(page.source).toBe("api");
    expect(page.data.total).toBe(214);
    expect(page.data.tasks).toHaveLength(1);
    expect(page.data.tasks[0].owner).toBe("Kavita Rao");
  });

  it("getOverdueTaskPage defaults to the first page of 50, clamps bad input, and falls back to the page length without meta", async () => {
    fetchMock.mockResolvedValueOnce(res({ data: [] }));
    await getOverdueTaskPage();
    expect(fetchMock.mock.calls[0][0]).toBe("v1/crm/activities/overdue-tasks?limit=50&offset=0");
    fetchMock.mockResolvedValueOnce(res({ data: [] }));
    await getOverdueTaskPage({ limit: 9999, offset: -5 });
    expect(fetchMock.mock.calls[1][0]).toBe("v1/crm/activities/overdue-tasks?limit=200&offset=0");
    fetchMock.mockResolvedValueOnce(
      res({ data: [{ id: "t1", type: "task", status: "open", dueDate: "2020-01-01" }, { id: "t2", type: "task", status: "open", dueDate: "2020-01-02" }] }),
    );
    expect((await getOverdueTaskPage()).data.total).toBe(2);
  });

  // GAP-CRM-TASK-ESCALATION-01 — a rule preview counts what ITS threshold matches.
  it("getOverdueMatchCount asks the server to count tasks overdue by at least the threshold", async () => {
    fetchMock.mockResolvedValueOnce(res({ data: [], meta: { total: 37, limit: 1, offset: 0 } }));
    const r = await getOverdueMatchCount(2880);
    expect(fetchMock.mock.calls[0][0]).toBe("v1/crm/activities/overdue-tasks?limit=1&offset=0&minAgeMinutes=2880");
    expect(r).toEqual({ data: 37, source: "api" });
    fetchMock.mockResolvedValueOnce(res({}, 500));
    expect((await getOverdueMatchCount(60)).source).toBe("error");
    // A reply with no total is "unknown", not a fabricated zero.
    fetchMock.mockResolvedValueOnce(res({ data: [] }));
    expect((await getOverdueMatchCount(60)).source).toBe("error");
  });

  // GAP-CRM-TASK-ESCALATION-01 — create/update post crm-service's contract and surface its refusals.
  it("createTaskEscalationRule / updateTaskEscalationRule post the crm-service body shape", async () => {
    fetchMock.mockResolvedValueOnce(res({}, 201));
    await createTaskEscalationRule({ name: "After a day", thresholdMinutes: 1440, managerRole: "sales_manager", managerId: "", enabled: true });
    expect(fetchMock.mock.calls[0][0]).toBe("v1/crm/task-escalation-rules");
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      name: "After a day", appliesTo: "both", thresholdMinutes: 1440, recipientRole: "sales_manager", recipientId: null, enabled: true,
    });
    fetchMock.mockResolvedValueOnce(res({}, 200));
    await updateTaskEscalationRule("e 1", { name: "x", thresholdMinutes: 60, managerRole: "", managerId: "u-1", enabled: true });
    expect(fetchMock.mock.calls[1][0]).toBe("v1/crm/task-escalation-rules/e%201");
    expect((fetchMock.mock.calls[1][1] as RequestInit).method).toBe("PUT");
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toMatchObject({ recipientId: "u-1", recipientRole: null });
  });

  it("a recipient the server refuses surfaces as a typed rejection the editor can word; other failures stay generic", async () => {
    const rule = { name: "x", thresholdMinutes: 60, managerRole: "ghost", managerId: "", enabled: true };
    fetchMock.mockResolvedValueOnce(res({ code: "INVALID_RECIPIENT_ROLE", message: "no such role" }, 422));
    const err = await createTaskEscalationRule(rule).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TaskEscalationRuleRejected);
    expect((err as TaskEscalationRuleRejected).code).toBe("INVALID_RECIPIENT_ROLE");
    // The server's own text is never what the reader sees.
    expect((err as Error).message).not.toMatch(/no such role/);
    fetchMock.mockResolvedValueOnce(res({ code: "SOMETHING_ELSE" }, 500));
    const other = await createTaskEscalationRule(rule).catch((e: unknown) => e);
    expect(other).not.toBeInstanceOf(TaskEscalationRuleRejected);
    expect(other).toBeInstanceOf(Error);
  });

  it("snoozeTask and reassignTask PATCH the activity with a reason", async () => {
    fetchMock.mockResolvedValueOnce(res({}, 202));
    await snoozeTask("t1", "2099-01-01", "Citizen asked to call later");
    expect(fetchMock.mock.calls[0][0]).toBe("v1/crm/activities/t1");
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ dueDate: "2099-01-01", reason: "Citizen asked to call later" });
    fetchMock.mockResolvedValueOnce(res({}, 202));
    await reassignTask("t1", "u-2", "Original owner on leave");
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({ ownerId: "u-2", reason: "Original owner on leave" });
  });

  it("createCommunication / createAddress / createContactRole / connectLinkedAccount hit the right paths", async () => {
    fetchMock.mockResolvedValueOnce(res({}, 202));
    await createCommunication({ subjectType: "contact", subjectId: "c1", direction: "outbound", channel: "phone", occurredAt: "2026-01-01T00:00:00Z", summary: "s" });
    expect(fetchMock.mock.calls[0][0]).toBe("v1/crm/communications");

    fetchMock.mockResolvedValueOnce(res({}, 200));
    await createAddress({ ownerType: "contact", ownerId: "c1", addressType: "office", line1: "1", line2: "", city: "X", state: "", pincode: "111111", country: "India", isPrimary: true });
    expect(fetchMock.mock.calls[1][0]).toBe("v1/crm/addresses");

    fetchMock.mockResolvedValueOnce(res({}, 202));
    await createContactRole("c1", "d1", "beneficiary");
    expect(fetchMock.mock.calls[2][0]).toBe("v1/crm/contacts/c1/roles");

    fetchMock.mockResolvedValueOnce(res({}, 201));
    await connectLinkedAccount("google", "a@b.com");
    const body = JSON.parse((fetchMock.mock.calls[3][1] as RequestInit).body as string);
    expect(body.status).toBe("pending");
  });

  it("getContact360 / getAccount360 return api + normalise, error on failure", async () => {
    fetchMock.mockResolvedValueOnce(res({ score: 5, external: { caseCount: null, documentCount: null, source: "external" } }));
    const c = await getContact360("c1");
    expect(c.source).toBe("api");
    expect(c.data.score).toBe(5);
    fetchMock.mockResolvedValueOnce(res({}, 500));
    const a = await getAccount360("a1");
    expect(a.source).toBe("error");
    expect(a.data.external.source).toBe("external");
  });

  // crm-service answers GET /v1/crm/{contacts,accounts}/:id/360 as `{ data: {...} }`.
  it("normalise360: unwraps the live { data } envelope (a bare payload still works)", () => {
    const live = normalise360({
      data: {
        score: 41,
        deals: [{ id: "d9", name: "Live Deal", stage: "closed_won" }],
        consent: { marketingConsent: false, consentDate: null, purpose: null, channel: null, updatedAt: null },
      },
    });
    expect(live.score).toBe(41);
    expect(live.deals[0].id).toBe("d9");
    expect(live.consent?.marketing).toBe(false);
    expect(normalise360({ score: 41 }).score).toBe(41);
  });

  it("normalise360: reads the contact 360 consent record (marketingConsent / purpose / channel / updatedAt)", () => {
    const v = normalise360({
      data: {
        consent: {
          marketingConsent: true,
          consentDate: "2026-03-01",
          purpose: "research",
          channel: "web_form",
          updatedAt: "2026-03-01T10:00:00.000Z",
        },
      },
    });
    expect(v.consent).toEqual({
      marketing: true,
      updatedAt: "2026-03-01T10:00:00.000Z",
      purpose: "research",
      channel: "web_form",
    });
    // consent that predates updatedAt falls back to the bare consentDate
    const legacy = normalise360({ consent: { marketingConsent: true, consentDate: "2024-01-01" } });
    expect(legacy.consent?.updatedAt).toBe("2024-01-01");
    expect(legacy.consent?.purpose).toBeUndefined();
  });
});
