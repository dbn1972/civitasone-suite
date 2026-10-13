import { describe, it, expect } from "vitest";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

type Ns = Record<string, string>;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("workflowApproveGate: en/hi parity (GAP-WORKFLOW-INSTANCES-DETAIL-02)", () => {
  const enNs = (en as unknown as Record<string, Ns>).workflowApproveGate;
  const hiNs = (hi as unknown as Record<string, Ns>).workflowApproveGate;

  it("exists in both locales with the same keys", () => {
    expect(enNs).toBeDefined();
    expect(hiNs).toBeDefined();
    expect(Object.keys(hiNs).sort()).toEqual(Object.keys(enNs).sort());
  });

  it("has non-empty hi strings with identical placeholders", () => {
    for (const [k, v] of Object.entries(enNs)) {
      expect(hiNs[k]?.trim().length, `${k} empty in hi`).toBeGreaterThan(0);
      expect(placeholders(hiNs[k]!), k).toEqual(placeholders(v));
    }
  });
});
