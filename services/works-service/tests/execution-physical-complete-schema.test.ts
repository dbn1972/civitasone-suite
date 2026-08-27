/**
 * Regression test: physicalCompleteSchema.completionDate used to be
 * z.string().datetime(), which requires a full ISO-8601 timestamp
 * (e.g. "2026-01-10T00:00:00Z"). The only caller —
 * apps/web/.../works/execution/[workId]/ExecutionActions.tsx — uses a plain
 * <input type="date">, which produces bare "YYYY-MM-DD" values. Every real
 * submission with a date filled in was rejected with 400 (live-confirmed
 * via the gateway during the works deep-verify pass). Fixed to a plain
 * z.string(), matching the working aaDate/tsDate convention already
 * established in approval/validators.ts for the identical situation.
 */
import { describe, it, expect } from "vitest";
import { physicalCompleteSchema } from "../src/modules/execution/validators.js";

const WORK_ID = "00000000-1111-4000-8000-000000000001";

describe("physicalCompleteSchema.completionDate", () => {
  it("accepts the bare 'YYYY-MM-DD' value a real <input type=date> sends (was: 400)", () => {
    const result = physicalCompleteSchema.safeParse({ workId: WORK_ID, completionDate: "2026-01-10" });
    expect(result.success).toBe(true);
  });

  it("still accepts a full ISO datetime, for any caller that already sends one", () => {
    const result = physicalCompleteSchema.safeParse({ workId: WORK_ID, completionDate: "2026-01-10T00:00:00Z" });
    expect(result.success).toBe(true);
  });

  it("still accepts the field being omitted entirely (optional)", () => {
    const result = physicalCompleteSchema.safeParse({ workId: WORK_ID });
    expect(result.success).toBe(true);
  });
});
