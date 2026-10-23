import { describe, it, expect } from "vitest";
import { feeWaiverAudit } from "./consumer.js";

describe("feeWaiverAudit", () => {
  it("lists office waivers that carry a reason", () => {
    expect(feeWaiverAudit([
      { officeId: "o1", feeFromMinor: 0, feeWaiverReason: "statutory exemption" },
      { officeId: "o2", feeFromMinor: 500 },
      { officeId: "o3", feeFromMinor: 0, feeWaiverReason: "   " },
    ])).toEqual({ feeWaivers: [{ officeId: "o1", feeFromMinor: 0, feeWaiverReason: "statutory exemption" }] });
  });
  it("is undefined when there is nothing to record", () => {
    expect(feeWaiverAudit(undefined)).toBeUndefined();
    expect(feeWaiverAudit([{ officeId: "o" }])).toBeUndefined();
  });
});

import { updateDefinitionBody } from "./validators.js";

describe("officeOverrides keep feeWaiverReason through validation", () => {
  it("does not strip feeWaiverReason (it used to be dropped by the schema)", () => {
    const officeId = "11111111-1111-4111-8111-111111111111";
    const parsed = updateDefinitionBody.parse({
      officeOverrides: [{ officeId, feeFromMinor: 0, feeWaiverReason: "statutory exemption" }],
    });
    expect(parsed.officeOverrides?.[0]?.feeWaiverReason).toBe("statutory exemption");
  });
});
