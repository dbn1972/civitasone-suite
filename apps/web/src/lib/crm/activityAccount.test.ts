import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  normaliseActivities,
  normaliseCommunications,
  normaliseAddresses,
  normaliseContactRoles,
  normaliseRelationships,
  normaliseTaskEscalationRules,
  normaliseOverdueTasks,
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
  getOverdueTasks,
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
        { id: "a2", type: "meeting", subject: "new", createdAt: "2026-05-01T00:00:00Z", dueAt: "2026-05-02T10:00:00Z", location: "HQ" },
        { type: "note" }, // dropped: no id
        "junk",
      ],
    });
    expect(out.map((a) => a.id)).toEqual(["a2", "a1"]);
    expect(out[0].location).toBe("HQ");
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
      communications: [{ id: "c1", occurredAt: "2026-01-01T00:00:00Z" }],
      deals: [{ id: "d1", name: "Deal", stage: "won", amount: 5000 }],
      quotations: [{ id: "q1", reference: "Q-1", status: "sent", total: 100 }],
      nextActions: [{ id: "n1", title: "call", status: "open", dueDate: "2026-02-02" }],
      roles: [{ id: "r1", role: "champion", dealId: "d1" }],
      addresses: [{ id: "ad1", addressType: "office", line1: "1", city: "X", pincode: "111111" }],
      consent: { marketing: true, updatedAt: "2026-01-01T00:00:00Z" },
      score: 72,
      external: { caseCount: null, documentCount: null, source: "external" },
    });
    expect(v.deals[0].amount).toBe(5000);
    expect(v.quotations[0].amount).toBe(100);
    expect(v.nextActions[0].dueAt).toBe("2026-02-02");
    expect(v.consent?.marketing).toBe(true);
    expect(v.score).toBe(72);
    expect(v.external.caseCount).toBeNull();
    expect(v.external.documentCount).toBeNull();
  });

  it("normalise360: empty input yields safe defaults + external stub", () => {
    const v = normalise360(null);
    expect(v.activities).toEqual([]);
    expect(v.score).toBeNull();
    expect(v.consent).toBeNull();
    expect(v.external.source).toBe("external");
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

  it("createActivity maps deal->dealId and throws server error", async () => {
    fetchMock.mockResolvedValueOnce(res({}, 200));
    await createActivity({ type: "note", subjectType: "deal", subjectId: "d1", text: "hi" });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.dealId).toBe("d1");
    fetchMock.mockResolvedValueOnce(res({ code: "BAD", message: "no" }, 400));
    await expect(createActivity({ type: "note", subjectType: "contact", subjectId: "c1", text: "x" })).rejects.toThrow(/BAD/);
  });

  it("communications, addresses, roles, relationships, escalation, overdue, linked loaders gate errors", async () => {
    for (const loader of [
      () => getCommunications("contact", "c1"),
      () => getAddresses("contact", "c1"),
      () => getContactRoles("c1"),
      () => getAccountRelationships("a1"),
      () => getTaskEscalationRules(),
      () => getOverdueTasks(),
      () => getLinkedAccounts(),
    ]) {
      fetchMock.mockResolvedValueOnce(res([], 200));
      expect((await loader()).source).toBe("api");
      fetchMock.mockResolvedValueOnce(res({}, 500));
      expect((await loader()).source).toBe("error");
    }
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
});
