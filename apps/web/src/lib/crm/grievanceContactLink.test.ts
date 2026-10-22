import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchContacts, getOpenGrievancesForContact } from "./grievanceContactLink";

const CONTACT = "11111111-1111-4111-8111-111111111111";

describe("grievanceContactLink (GAP-CRM-GRIEVANCES-NEW-01)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("searches the masked contact lookup endpoint by name and maps id, label and masked sublabel", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: CONTACT, name: "Ravi Kumar", phone: "98XXXXX210", email: "r***@e***.com" }, { name: "no id" }] }),
        { status: 200 },
      ),
    );
    const out = await searchContacts("  Ravi ", new AbortController().signal);
    expect(String(spy.mock.calls[0]![0])).toBe("/api/proxy/v1/crm/contacts/lookup?q=Ravi&limit=10");
    expect(out).toEqual([{ id: CONTACT, label: "Ravi Kumar", sublabel: "98XXXXX210 · r***@e***.com" }]);
  });

  it("lists the contact's OPEN grievances and reports the total", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "g1", referenceNo: "DARPG/2026/000001", subject: "No water" }, { id: "g2" }],
          meta: { total: 7 },
        }),
        { status: 200 },
      ),
    );
    const out = await getOpenGrievancesForContact(CONTACT);
    expect(String(spy.mock.calls[0]![0])).toBe(`/api/proxy/v1/crm/grievances?contactId=${CONTACT}&open=true&limit=5`);
    expect(out).toEqual({ items: [{ id: "g1", referenceNo: "DARPG/2026/000001", subject: "No water" }], total: 7 });
  });

  it("fails soft: a failed duplicate lookup never blocks filing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 500 }));
    expect(await getOpenGrievancesForContact(CONTACT)).toEqual({ items: [], total: 0 });
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("offline"));
    expect(await getOpenGrievancesForContact(CONTACT)).toEqual({ items: [], total: 0 });
  });
});
