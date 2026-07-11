/**
 * Pure-domain tests for cause-list: deterministic id derivation used as
 * idempotency keys (§17) — one cause-list per court/day, one item per (list, case).
 */
import { describe, it, expect } from "vitest";
import { deriveCauseListId, deriveItemId } from "../src/modules/cause-list/domain.js";

const UUIDV5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("cause-list domain — id derivation", () => {
  const tenant = "11111111-1111-1111-1111-111111111111";
  const court = "22222222-2222-2222-2222-222222222222";

  it("deriveCauseListId is a stable, valid UUIDv5 for the same (tenant, court, date)", () => {
    const a = deriveCauseListId(tenant, court, "2026-07-11");
    const b = deriveCauseListId(tenant, court, "2026-07-11");
    expect(a).toBe(b);
    expect(a).toMatch(UUIDV5);
  });

  it("deriveCauseListId differs across date, court and tenant (collision-free)", () => {
    const base = deriveCauseListId(tenant, court, "2026-07-11");
    expect(deriveCauseListId(tenant, court, "2026-07-12")).not.toBe(base);
    expect(deriveCauseListId(tenant, "33333333-3333-3333-3333-333333333333", "2026-07-11")).not.toBe(base);
    expect(deriveCauseListId("99999999-9999-9999-9999-999999999999", court, "2026-07-11")).not.toBe(base);
  });

  it("deriveItemId is a stable, valid UUIDv5 for the same (tenant, list, case)", () => {
    const list = deriveCauseListId(tenant, court, "2026-07-11");
    const caseId = "44444444-4444-4444-4444-444444444444";
    const a = deriveItemId(tenant, list, caseId);
    const b = deriveItemId(tenant, list, caseId);
    expect(a).toBe(b);
    expect(a).toMatch(UUIDV5);
  });

  it("deriveItemId differs across case and cause-list (collision-free)", () => {
    const list = deriveCauseListId(tenant, court, "2026-07-11");
    const other = deriveCauseListId(tenant, court, "2026-07-12");
    const caseA = "44444444-4444-4444-4444-444444444444";
    const caseB = "55555555-5555-5555-5555-555555555555";
    const base = deriveItemId(tenant, list, caseA);
    expect(deriveItemId(tenant, list, caseB)).not.toBe(base);
    expect(deriveItemId(tenant, other, caseA)).not.toBe(base);
  });
});
