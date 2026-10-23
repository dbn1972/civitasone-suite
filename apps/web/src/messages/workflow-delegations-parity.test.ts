import { describe, it, expect } from "vitest";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

type Ns = Record<string, string>;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("workflowDelegations: en/hi parity", () => {
  const enNs = (en as unknown as Record<string, Ns>).workflowDelegations;
  const hiNs = (hi as unknown as Record<string, Ns>).workflowDelegations;

  it("exists in both locales with the same keys", () => {
    expect(enNs).toBeDefined();
    expect(hiNs).toBeDefined();
    expect(Object.keys(hiNs).sort()).toEqual(Object.keys(enNs).sort());
  });

  it("has real (non-empty, translated) hi strings with identical placeholders", () => {
    for (const [k, v] of Object.entries(enNs)) {
      expect(hiNs[k]?.trim().length, `${k} empty in hi`).toBeGreaterThan(0);
      expect(hiNs[k], `${k} not translated`).not.toBe(v);
      expect(placeholders(hiNs[k]!), k).toEqual(placeholders(v));
    }
  });

  it("covers the three delegation error codes the API returns", () => {
    for (const code of ["DELEGATION_ROLE_NOT_HELD", "DELEGATION_TOO_LONG", "DELEGATION_BAD_RANGE"]) {
      expect(enNs[`err_${code}`], code).toBeTruthy();
      expect(hiNs[`err_${code}`], code).toBeTruthy();
    }
  });
});
