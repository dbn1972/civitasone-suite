import { describe, it, expect } from "vitest";
import { definitionDesignHash } from "./design-hash.js";

const base = {
  serviceKey: "k", name: "Svc", slaDays: 7, channels: ["portal"],
  forms: [{ id: "f", fields: [{ a: 1, b: 2 }] }], officeOverrides: [{ officeId: "o", feeFromMinor: 0 }],
};

describe("definitionDesignHash", () => {
  it("is stable across key order and ignores bookkeeping fields", () => {
    const a = definitionDesignHash(base as never);
    const reordered = definitionDesignHash({ officeOverrides: base.officeOverrides, forms: [{ fields: [{ b: 2, a: 1 }], id: "f" }], channels: ["portal"], slaDays: 7, name: "Svc", serviceKey: "k" } as never);
    const withBookkeeping = definitionDesignHash({ ...base, status: "draft", version: 9, updatedAt: new Date(), submittedBy: "u", rowVersion: 4 } as never);
    expect(reordered).toBe(a);
    expect(withBookkeeping).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ["fee override", { officeOverrides: [{ officeId: "o", feeFromMinor: 100 }] }],
    ["waiver reason", { officeOverrides: [{ officeId: "o", feeFromMinor: 0, feeWaiverReason: "x" }] }],
    ["sla", { slaDays: 8 }],
    ["form", { forms: [{ id: "f", fields: [{ a: 1, b: 3 }] }] }],
    ["channels", { channels: ["portal", "counter"] }],
  ])("changes when the %s changes", (_n, patch) => {
    expect(definitionDesignHash({ ...base, ...patch } as never)).not.toBe(definitionDesignHash(base as never));
  });
});
