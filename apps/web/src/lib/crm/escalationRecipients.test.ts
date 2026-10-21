import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  escalationRuleBody,
  createEscalationRule,
  updateEscalationRule,
  getEscalationRecipients,
  normaliseEscalationRule,
  EscalationRecipientError,
  type EscalationRule,
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
// Braces matter: returning the mock from beforeEach would make vitest call it as a teardown hook.
beforeEach(() => { fetchMock.mockReset(); });

const base: EscalationRule = {
  trigger: "unaccepted",
  thresholdMinutes: 60,
  recipientRole: "",
  recipientId: "",
  reassign: false,
  enabled: true,
};

// GAP-CRM-ESCALATION-RULES-01 -- crm-service's upsertEscalationRuleBody REQUIRES a
// name and wants recipientId to be a UUID when present. The editor's raw rows had
// neither a name nor an omitted-when-empty recipientId, so every save was a 400.
describe("escalationRuleBody (wire shape of crm-service upsertEscalationRuleBody)", () => {
  it("always carries a name, derived from the trigger and threshold when the row has none", () => {
    const body = escalationRuleBody({ ...base, recipientRole: "lead_desk" });
    expect(body.name).toBe("Not accepted in time · 60 min");
  });

  it("keeps an explicit name and caps it at the server's 200 characters", () => {
    expect(escalationRuleBody({ ...base, name: "  Tier 1 SLA  ", recipientRole: "lead_desk" }).name).toBe("Tier 1 SLA");
    expect((escalationRuleBody({ ...base, name: "x".repeat(300), recipientRole: "lead_desk" }).name as string).length).toBe(200);
  });

  it("omits an unset recipient instead of sending an empty string (recipientId must be a UUID)", () => {
    const roleOnly = escalationRuleBody({ ...base, recipientRole: "lead_desk" });
    expect(roleOnly).toHaveProperty("recipientRole", "lead_desk");
    expect(roleOnly).not.toHaveProperty("recipientId");

    const userOnly = escalationRuleBody({ ...base, recipientId: "6f1c0a52-8f9e-4d0f-9d1b-1f0a5c2b7a11" });
    expect(userOnly).toHaveProperty("recipientId", "6f1c0a52-8f9e-4d0f-9d1b-1f0a5c2b7a11");
    expect(userOnly).not.toHaveProperty("recipientRole");
  });

  it("trims recipients and passes the flags through; never leaks the client-only id", () => {
    const body = escalationRuleBody({ ...base, id: "e1", recipientRole: " lead_desk ", reassign: true, enabled: false });
    expect(body).toMatchObject({ recipientRole: "lead_desk", reassign: true, enabled: false, trigger: "unaccepted", thresholdMinutes: 60 });
    expect(body).not.toHaveProperty("id");
  });
});

describe("escalation rule create / update send the schema-valid body", () => {
  it("POSTs name + only the set recipient", async () => {
    fetchMock.mockResolvedValue(res({}, 202));
    await createEscalationRule({ ...base, name: "Lead SLA", recipientRole: "lead_desk" });
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe("v1/crm/escalation-rules");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      name: "Lead SLA", trigger: "unaccepted", thresholdMinutes: 60, recipientRole: "lead_desk", reassign: false, enabled: true,
    });
  });

  it("PUTs the same shape to the rule's URL", async () => {
    fetchMock.mockResolvedValue(res({}, 202));
    await updateEscalationRule("e1", { ...base, id: "e1", name: "Lead SLA", recipientRole: "lead_desk" });
    const [path, init] = fetchMock.mock.calls[0]!;
    expect(path).toBe("v1/crm/escalation-rules/e1");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("recipientId");
  });

  it("raises a typed EscalationRecipientError for a refused recipient (422) so the editor can explain it", async () => {
    fetchMock.mockResolvedValue(res({ code: "INVALID_RECIPIENT", message: "recipientRole must be an active role in this tenant" }, 422));
    const err = await createEscalationRule({ ...base, recipientRole: "typo" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EscalationRecipientError);
    expect((err as EscalationRecipientError).kind).toBe("invalid");
  });

  it("raises the 'unavailable' kind when the server could not verify the recipient (503)", async () => {
    fetchMock.mockResolvedValue(res({ code: "DIRECTORY_UNAVAILABLE", message: "could not verify" }, 503));
    const err = await updateEscalationRule("e1", { ...base, recipientRole: "lead_desk" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EscalationRecipientError);
    expect((err as EscalationRecipientError).kind).toBe("unavailable");
  });

  it("keeps a plain Error (status-aware message) for any other failure", async () => {
    fetchMock.mockResolvedValue(res({ code: "DUPLICATE_RULE", message: "dup" }, 409));
    const err = await createEscalationRule({ ...base, recipientRole: "lead_desk" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(EscalationRecipientError);
  });
});

describe("normaliseEscalationRule keeps the stored name", () => {
  it("round-trips a name and omits it when absent", () => {
    expect(normaliseEscalationRule({ id: "e1", name: " Tier 1 ", trigger: "unaccepted", thresholdMinutes: 30 })?.name).toBe("Tier 1");
    expect(normaliseEscalationRule({ id: "e1", trigger: "unaccepted", thresholdMinutes: 30 })).not.toHaveProperty("name");
  });
});

describe("getEscalationRecipients", () => {
  it("parses roles, users and the availability flags", async () => {
    fetchMock.mockResolvedValue(res({
      data: { roles: [{ key: "lead_desk", label: "Lead Desk" }, { key: "x" }], users: [{ id: "u1", name: "Asha Rao" }, { id: "u2" }] },
      meta: { rolesAvailable: true, usersAvailable: true, usersTruncated: false },
    }));
    const out = await getEscalationRecipients();
    expect(fetchMock.mock.calls[0]![0]).toBe("v1/crm/escalation-rules/recipients");
    expect(out.source).toBe("api");
    expect(out.data.roles).toEqual([{ key: "lead_desk", label: "Lead Desk" }, { key: "x", label: "x" }]);
    expect(out.data.users).toEqual([{ id: "u1", name: "Asha Rao" }, { id: "u2", name: "u2" }]);
    expect(out.data).toMatchObject({ rolesAvailable: true, usersAvailable: true, usersTruncated: false });
  });

  it("carries a per-directory 'unavailable' through (empty list != no roles exist)", async () => {
    fetchMock.mockResolvedValue(res({ data: { roles: [], users: [{ id: "u1", name: "A" }] }, meta: { rolesAvailable: false, usersAvailable: true, usersTruncated: true } }));
    const out = await getEscalationRecipients();
    expect(out.data).toMatchObject({ rolesAvailable: false, usersAvailable: true, usersTruncated: true });
  });

  it("does not read a missing availability flag as 'available'", async () => {
    fetchMock.mockResolvedValue(res({ data: { roles: [{ key: "a" }], users: [] } }));
    const out = await getEscalationRecipients();
    expect(out.data.rolesAvailable).toBe(false);
    expect(out.data.usersAvailable).toBe(false);
  });

  it("reports source 'error' with both directories unavailable on a non-2xx", async () => {
    fetchMock.mockResolvedValue(res({}, 403));
    const out = await getEscalationRecipients();
    expect(out.source).toBe("error");
    expect(out.data).toEqual({ roles: [], users: [], rolesAvailable: false, usersAvailable: false, usersTruncated: false });
  });

  it("reports source 'error' with both directories unavailable on a network failure", async () => {
    fetchMock.mockImplementation(async () => { throw new Error("offline"); });
    const out = await getEscalationRecipients();
    expect(out.source).toBe("error");
    expect(out.data.rolesAvailable).toBe(false);
    expect(out.data.usersAvailable).toBe(false);
  });
});
