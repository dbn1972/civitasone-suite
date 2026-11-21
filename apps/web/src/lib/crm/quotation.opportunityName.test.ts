/**
 * GAP-CRM display: the quotations list Opportunity column must show the linked deal's
 * name, resolved by the service as `dealName`, never a raw deal UUID.
 */
import { describe, it, expect } from "vitest";
import { normaliseQuotation } from "./quotation";

const UUID = "22222222-2222-4222-8222-222222222222";

describe("normaliseQuotation maps the resolved opportunity (deal) name", () => {
  it("reads the service-resolved dealName into opportunityName", () => {
    const q = normaliseQuotation({ id: "q1", dealId: UUID, dealName: "Acme Expansion", status: "draft", lineItems: [] });
    expect(q?.opportunityId).toBe(UUID);
    expect(q?.opportunityName).toBe("Acme Expansion");
  });
  it("leaves opportunityName undefined when the deal link is unresolved", () => {
    const q = normaliseQuotation({ id: "q1", dealId: UUID, status: "draft", lineItems: [] });
    expect(q?.opportunityId).toBe(UUID);
    expect(q?.opportunityName).toBeUndefined();
  });
});
