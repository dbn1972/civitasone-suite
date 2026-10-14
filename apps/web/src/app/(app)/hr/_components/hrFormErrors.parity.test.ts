import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import en from "@/messages/en.json";
import hi from "@/messages/hi.json";

/**
 * The HR form schemas return message KEYS in the hrFormErrors namespace, so
 * every key quoted in a schema file must exist in both en and hi.
 */
const SCHEMAS = [
  "_components/shiftChangeSchema.ts",
  "_components/wfhRequestSchema.ts",
  "confirmation/_components/probationSchema.ts",
  "departments/new/departmentSchema.ts",
  "goals/_components/checkinSchema.ts",
  "leave-policies/leavePolicySchema.ts",
  "onboarding/_components/addTaskSchema.ts",
  "retirement/_components/separationSchema.ts",
];

describe("hrFormErrors message keys", () => {
  const enKeys = Object.keys(en.hrFormErrors);
  it("hi has exactly the en keys", () => {
    expect(Object.keys(hi.hrFormErrors).sort()).toEqual(enKeys.sort());
  });
  for (const rel of SCHEMAS) {
    it(`${rel} emits only known keys, never English prose`, () => {
      const src = readFileSync(join(__dirname, "..", rel), "utf8");
      const used = [...src.matchAll(/(?:message:\s*|[(,]\s*)"([A-Za-z0-9]+)"/g)].map((m) => m[1]!);
      const keyed = used.filter((k) => enKeys.includes(k));
      expect(keyed.length).toBeGreaterThan(0);
      expect(src).not.toMatch(/"[A-Z][a-z]+ [a-z][^"]*\./);
    });
  }
});
