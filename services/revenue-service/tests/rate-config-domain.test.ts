/**
 * Owner decision #2 (2026-10-26) — GAP-REVENUE-CONFIG-01, pure planning logic.
 *
 * A config proposal never changes a row in place: `create` inserts, `revise`
 * end-dates the old row and inserts a NEW VERSION effective from the proposal
 * date, `end_date` sets effective_to (deactivation is an end-date). The planner
 * is pure: it returns the writes; the consumer executes them, the preview
 * applies them to an in-memory copy and re-runs the rate engine.
 */
import { describe, it, expect } from "vitest";
import {
  planProposal,
  previewProposal,
  type ConfigState,
  type Proposal,
} from "../src/modules/rate-config/domain.js";
import { DomainError } from "../src/modules/rate-engine/domain.js";

const HEAD = "11111111-1111-4111-8111-111111111111";
const SLAB = "22222222-2222-4222-8222-222222222222";
const PEN = "33333333-3333-4333-8333-333333333333";
const REB = "44444444-4444-4444-8444-444444444444";
const TODAY = "2026-10-26";

const slab = (over: Record<string, unknown> = {}) => ({
  id: SLAB, rateHeadId: HEAD, slabType: "flat", bandFrom: null, bandTo: null, rateValue: 100_000n,
  effectiveFrom: "2026-04-01", effectiveTo: null, isActive: true, version: 1, ...over,
});
const penalty = (over: Record<string, unknown> = {}) => ({
  id: PEN, rateHeadId: HEAD, interestType: "simple", annualRateBps: 1200, graceDays: 0, capMonths: null,
  roundingMode: "floor", effectiveFrom: "1970-01-01", effectiveTo: null, isActive: true, version: 1, ...over,
});
const rebate = (over: Record<string, unknown> = {}) => ({
  id: REB, rateHeadId: HEAD, rebateType: "early_payment", discountBps: 500, validUntilDaysBeforeDue: 30,
  effectiveFrom: "1970-01-01", effectiveTo: null, isActive: true, version: 1, ...over,
});
const state = (over: Partial<ConfigState> = {}): ConfigState => ({
  heads: [{ id: HEAD, code: "PT", name: "Property tax", category: "property_tax", unitOfMeasure: null, isActive: true, effectiveTo: null, version: 1 }],
  slabs: [slab()], penalties: [penalty()], rebates: [rebate()], ...over,
} as ConfigState);
const proposal = (over: Partial<Proposal>): Proposal => ({
  id: "55555555-5555-4555-8555-555555555555", kind: "rate_slab", action: "create", targetId: null, rateHeadId: HEAD,
  effectiveFrom: "2026-11-01", payload: {}, ...over,
});

describe("planProposal — never in place, always effective-dated (owner decision #2)", () => {
  it("rate_slab revise: end-dates the old row at the new effective date and inserts the NEXT VERSION", () => {
    const ops = planProposal(state(), proposal({ action: "revise", targetId: SLAB, payload: { rateValue: "150000" } }), TODAY);
    const upd = ops.find((o) => o.op === "update")!;
    const ins = ops.find((o) => o.op === "insert")!;
    expect(upd).toMatchObject({ table: "rate_slabs", id: SLAB, values: { effectiveTo: "2026-11-01" } });
    expect(ins.table).toBe("rate_slabs");
    expect(ins.values).toMatchObject({ rateHeadId: HEAD, slabType: "flat", rateValue: 150_000n, effectiveFrom: "2026-11-01", effectiveTo: null, version: 2 });
  });

  it("rate_slab create is refused when it overlaps a live slab (server is the authority)", () => {
    expect(() => planProposal(state(), proposal({ action: "create", payload: { rateHeadId: HEAD, slabType: "flat", rateValue: "1" } }), TODAY))
      .toThrow(DomainError);
  });

  it("rate_slab create is allowed when the window does not overlap", () => {
    const s = state({ slabs: [slab({ effectiveTo: "2026-10-31" })] } as Partial<ConfigState>);
    const ops = planProposal(s, proposal({ action: "create", payload: { rateHeadId: HEAD, slabType: "flat", rateValue: "200000" } }), TODAY);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: "insert", table: "rate_slabs", values: { effectiveFrom: "2026-11-01", rateValue: 200_000n } });
  });

  it("end_date sets effective_to — and flips is_active off only when the end date has already arrived", () => {
    const future = planProposal(state(), proposal({ action: "end_date", targetId: SLAB, effectiveFrom: "2026-12-31" }), TODAY);
    expect(future).toEqual([{ op: "update", table: "rate_slabs", id: SLAB, values: { effectiveTo: "2026-12-31" } }]);
    const now = planProposal(state(), proposal({ action: "end_date", targetId: SLAB, effectiveFrom: TODAY }), TODAY);
    expect(now[0]!.values).toMatchObject({ effectiveTo: TODAY, isActive: false });
  });

  it("refuses to end-date a row on or before its own start, or one already ended earlier", () => {
    expect(() => planProposal(state({ slabs: [slab({ effectiveFrom: "2026-12-01" })] } as Partial<ConfigState>), proposal({ action: "end_date", targetId: SLAB, effectiveFrom: "2026-11-15" }), TODAY)).toThrow(/EFFECTIVE|start/i);
    expect(() => planProposal(state({ slabs: [slab({ effectiveTo: "2026-11-05" })] } as Partial<ConfigState>), proposal({ action: "end_date", targetId: SLAB, effectiveFrom: "2026-11-20" }), TODAY)).toThrow(DomainError);
  });

  it("is never retroactive: an effective date in the past is refused", () => {
    try {
      planProposal(state(), proposal({ action: "end_date", targetId: SLAB, effectiveFrom: "2026-10-01" }), TODAY);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("EFFECTIVE_DATE_IN_PAST");
    }
  });

  it("unknown target -> TARGET_NOT_FOUND", () => {
    try {
      planProposal(state(), proposal({ action: "revise", targetId: "66666666-6666-4666-8666-666666666666", payload: { rateValue: "1" } }), TODAY);
      throw new Error("expected throw");
    } catch (e) {
      expect((e as DomainError).code).toBe("TARGET_NOT_FOUND");
    }
  });

  it("penalty_rule revise inserts a new version row and closes the old one at the effective date", () => {
    const ops = planProposal(state(), proposal({ kind: "penalty_rule", action: "revise", targetId: PEN, payload: { annualRateBps: 1800 } }), TODAY);
    expect(ops.find((o) => o.op === "update")).toMatchObject({ table: "penalty_rules", id: PEN, values: { effectiveTo: "2026-11-01" } });
    expect(ops.find((o) => o.op === "insert")!.values).toMatchObject({ annualRateBps: 1800, interestType: "simple", effectiveFrom: "2026-11-01", version: 2 });
  });

  it("penalty_rule create is refused while another rule is live for the head (revise it instead)", () => {
    expect(() => planProposal(state(), proposal({ kind: "penalty_rule", action: "create", payload: { rateHeadId: HEAD, interestType: "simple", annualRateBps: 900, graceDays: 0, roundingMode: "floor" } }), TODAY)).toThrow(DomainError);
  });

  it("rebate_rule revise / end_date mirror penalty rules", () => {
    const rev = planProposal(state(), proposal({ kind: "rebate_rule", action: "revise", targetId: REB, payload: { discountBps: 800 } }), TODAY);
    expect(rev.find((o) => o.op === "insert")!.values).toMatchObject({ discountBps: 800, rebateType: "early_payment", version: 2 });
    const end = planProposal(state(), proposal({ kind: "rebate_rule", action: "end_date", targetId: REB, effectiveFrom: "2026-12-31" }), TODAY);
    expect(end[0]).toMatchObject({ op: "update", table: "rebate_rules", id: REB, values: { effectiveTo: "2026-12-31" } });
  });

  it("rate_head: create inserts; end_date end-dates; revise is not supported (a head is identity only)", () => {
    const created = planProposal(state(), proposal({ kind: "rate_head", action: "create", rateHeadId: null, payload: { code: "WTR", name: "Water", category: "water" } }), TODAY);
    expect(created[0]).toMatchObject({ op: "insert", table: "rate_heads", values: { code: "WTR", name: "Water", category: "water" } });
    const ended = planProposal(state(), proposal({ kind: "rate_head", action: "end_date", targetId: HEAD, effectiveFrom: "2026-12-31" }), TODAY);
    expect(ended[0]).toEqual({ op: "update", table: "rate_heads", id: HEAD, values: { effectiveTo: "2026-12-31" } });
    expect(() => planProposal(state(), proposal({ kind: "rate_head", action: "revise", targetId: HEAD, payload: { name: "x" } }), TODAY)).toThrow(DomainError);
  });
});

describe("previewProposal — the effect on a computed demand, before approval (owner decision #2)", () => {
  it("shows the demand principal before vs after a slab revision (flat slab 1,000.00 -> 1,500.00)", () => {
    const p = previewProposal(state(), proposal({ action: "revise", targetId: SLAB, payload: { rateValue: "150000" } }), { today: TODAY, baseValue: 10_000_000n });
    expect(p.sample).not.toBeNull();
    expect(p.sample!.asOfDate).toBe("2026-11-01");
    expect(p.sample!.before.principal).toBe("100000");
    expect(p.sample!.after.principal).toBe("150000");
    expect(p.changes.map((c) => c.op)).toEqual(["update", "insert"]);
  });

  it("shows the interest before vs after a penalty-rate revision", () => {
    const p = previewProposal(
      state({ slabs: [slab({ slabType: "ad_valorem", rateValue: 1000n })] } as Partial<ConfigState>),
      proposal({ kind: "penalty_rule", action: "revise", targetId: PEN, payload: { annualRateBps: 2400 } }),
      { today: TODAY, baseValue: 10_000_000n },
    );
    expect(BigInt(p.sample!.after.penalty)).toBeGreaterThan(BigInt(p.sample!.before.penalty));
  });

  it("has no computed sample for a rate head (no rate is changing) but still lists the change", () => {
    const p = previewProposal(state(), proposal({ kind: "rate_head", action: "create", rateHeadId: null, payload: { code: "WTR", name: "Water", category: "water" } }), { today: TODAY, baseValue: 1n });
    expect(p.sample).toBeNull();
    expect(p.changes).toHaveLength(1);
  });

  it("surfaces why a proposal could not be applied instead of previewing a broken change", () => {
    const p = previewProposal(state(), proposal({ action: "create", payload: { rateHeadId: HEAD, slabType: "flat", rateValue: "1" } }), { today: TODAY, baseValue: 1n });
    expect(p.blocked).toMatch(/overlap/i);
    expect(p.changes).toEqual([]);
  });
});
