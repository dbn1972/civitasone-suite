import { describe, it, expect, vi, beforeEach } from "vitest";
import { rotateLeadFormKey } from "./leadForms";

const ID = "8cf7f7eb-1de6-4a31-b48c-1f598ecf33c0";

describe("rotateLeadFormKey (GAP-CRM-LEAD-FORMS-01)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("POSTs to the form's rotate-key endpoint and returns the minted key", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: ID, status: "accepted", formKey: "d".repeat(64) }), { status: 202 }),
    );
    const out = await rotateLeadFormKey(ID);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/proxy/v1/crm/lead-capture-forms/${ID}/rotate-key`);
    expect(init.method).toBe("POST");
    expect(out).toEqual({ formKey: "d".repeat(64) });
  });

  it("tolerates an envelope without a key (the list reload shows it)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "accepted" }), { status: 202 }));
    expect(await rotateLeadFormKey(ID)).toEqual({ formKey: undefined });
  });

  it("throws a user-safe error on a refusal instead of returning a key", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "FORBIDDEN" }), { status: 403 }));
    await expect(rotateLeadFormKey(ID)).rejects.toThrow();
  });
});
