import { describe, it, expect } from "vitest";
import { createPreTenderSchema } from "../src/modules/tender/validators.js";

const base = { workId: "00000000-1111-4000-8000-000000000001" };

describe("C35 TENDERS-NEW-02 optional pre-tender register fields", () => {
  it("are optional: a pre-tender without them still validates", () => {
    expect(createPreTenderSchema.safeParse(base).success).toBe(true);
  });
  it("accept an estimated amount (minor-unit string), approving authority and contractor class ids", () => {
    const r = createPreTenderSchema.safeParse({
      ...base,
      tenderAmountMinor: "1250000000",
      approvingAuthorityId: "00000000-2222-4000-8000-000000000002",
      contractorClassId: "00000000-3333-4000-8000-000000000003",
    });
    expect(r.success).toBe(true);
  });
  it("reject malformed ids and a non-numeric amount", () => {
    expect(createPreTenderSchema.safeParse({ ...base, approvingAuthorityId: "not-a-uuid" }).success).toBe(false);
    expect(createPreTenderSchema.safeParse({ ...base, tenderAmountMinor: "12.5 lakh" }).success).toBe(false);
  });
});
