import { describe, it, expect, afterEach } from "vitest";
import { ZenPolicyEvaluator, canonicalJson, sha256 } from "../src/ZenPolicyEvaluator.js";
import {
  syntheticPacks,
  minTenurePack,
  sensitiveRotationPack,
  spouseMedicalPack,
} from "../src/rulepacks.js";
import { generateWorkforce } from "../src/generate.js";
import { runDeterminism } from "../src/determinism.js";

let evaluators: ZenPolicyEvaluator[] = [];
function newEvaluator(): ZenPolicyEvaluator {
  const e = new ZenPolicyEvaluator();
  evaluators.push(e);
  return e;
}
afterEach(() => {
  for (const e of evaluators) e.dispose();
  evaluators = [];
});

async function loaded(): Promise<ZenPolicyEvaluator> {
  const e = newEvaluator();
  for (const p of syntheticPacks) await e.loadPack(p);
  return e;
}

describe("ZenPolicyEvaluator — pack loading", () => {
  it("loads all synthetic packs and content-addresses each", async () => {
    const e = await loaded();
    const packs = e.listPacks();
    expect(packs).toHaveLength(3);
    for (const p of packs) {
      expect(p.synthetic).toBe(true);
      expect(p.packHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("packHash is stable for the same graph and differs across packs", async () => {
    const e = await loaded();
    const byId = Object.fromEntries(e.listPacks().map((p) => [p.packId, p.packHash]));
    const e2 = await loaded();
    const byId2 = Object.fromEntries(e2.listPacks().map((p) => [p.packId, p.packHash]));
    expect(byId).toEqual(byId2);
    const hashes = Object.values(byId);
    expect(new Set(hashes).size).toBe(hashes.length);
  });
});

describe("min-tenure pack (SYNTHETIC)", () => {
  it("standard 36-month minimum: 48 months eligible, 12 months not", async () => {
    const e = await loaded();
    const ok = await e.evaluate(minTenurePack.packId, { tenureMonths: 48, hardshipPosting: false });
    expect(ok.output).toMatchObject({ eligible: true, ruleId: "SYN-TEN-STD-36" });
    const no = await e.evaluate(minTenurePack.packId, { tenureMonths: 12, hardshipPosting: false });
    expect(no.output).toMatchObject({ eligible: false, ruleId: "SYN-TEN-FAIL" });
  });

  it("hardship posting lowers the minimum to 24 months", async () => {
    const e = await loaded();
    const d = await e.evaluate(minTenurePack.packId, { tenureMonths: 24, hardshipPosting: true });
    expect(d.output).toMatchObject({ eligible: true, ruleId: "SYN-TEN-HARDSHIP-24" });
  });
});

describe("sensitive-post rotation pack (SYNTHETIC)", () => {
  it("overdue beyond 60 months is mandatory rotation", async () => {
    const e = await loaded();
    const d = await e.evaluate(sensitiveRotationPack.packId, { sensitivePost: true, monthsInPost: 72 });
    expect(d.output).toMatchObject({ rotationDue: true, rotationPriority: "mandatory", ruleId: "SYN-ROT-OVERDUE-60" });
  });
  it("non-sensitive post is not applicable", async () => {
    const e = await loaded();
    const d = await e.evaluate(sensitiveRotationPack.packId, { sensitivePost: false, monthsInPost: 99 });
    expect(d.output).toMatchObject({ rotationDue: false, rotationPriority: "not_applicable", ruleId: "SYN-ROT-NA" });
  });
});

describe("spouse/medical priority pack (SYNTHETIC)", () => {
  it("medical ground maps to band A weight 100", async () => {
    const e = await loaded();
    const d = await e.evaluate(spouseMedicalPack.packId, { medicalGround: true, spouseGround: false, disability: false });
    expect(d.output).toMatchObject({ priorityBand: "A", weight: 100, ruleId: "SYN-PRI-MED-A" });
  });
  it("spouse ground maps to band B; no ground to band C", async () => {
    const e = await loaded();
    const b = await e.evaluate(spouseMedicalPack.packId, { medicalGround: false, spouseGround: true, disability: false });
    expect(b.output).toMatchObject({ priorityBand: "B", ruleId: "SYN-PRI-SPOUSE-B" });
    const c = await e.evaluate(spouseMedicalPack.packId, { medicalGround: false, spouseGround: false, disability: false });
    expect(c.output).toMatchObject({ priorityBand: "C", ruleId: "SYN-PRI-NONE-C" });
  });
});

describe("D-ST-07 criterion (5): per-decision rule id + citation in trace", () => {
  it("every decision table node exposes a ruleId and a resolved citation", async () => {
    const e = await loaded();
    const d = await e.evaluate(minTenurePack.packId, { tenureMonths: 48, hardshipPosting: false });
    const dt = d.trace.find((t) => t.ruleId !== undefined);
    expect(dt).toBeDefined();
    expect(dt?.ruleId).toBe("SYN-TEN-STD-36");
    expect(dt?.citation).toBeDefined();
    expect(dt?.citation).toMatchObject({
      ruleId: "SYN-TEN-STD-36",
      goReference: "SYN-GO-TEN-2026/01",
      policyId: "SYN-POLICY-SYN-TEN-STD-36",
    });
    // trace is ordered
    const orders = d.trace.map((t) => t.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });
});

describe("D-ST-07 criterion (4): determinism across 3 runs", () => {
  it("outputs AND traces are byte-identical across 3 runs for every pack", async () => {
    const report = await runDeterminism(3, 20261009, 300);
    expect(report.allPass).toBe(true);
    for (const p of report.packs) {
      expect(p.outputsIdentical).toBe(true);
      expect(p.tracesIdentical).toBe(true);
      expect(new Set(p.outputHashPerRun).size).toBe(1);
      expect(new Set(p.traceHashPerRun).size).toBe(1);
      expect(p.everyDecisionHasRuleId).toBe(true);
      expect(p.everyDecisionHasCitation).toBe(true);
    }
  });

  it("decisionHash is stable across evaluator instances for identical input", async () => {
    const e1 = await loaded();
    const e2 = await loaded();
    const input = { tenureMonths: 40, hardshipPosting: false };
    const a = await e1.evaluate(minTenurePack.packId, input);
    const b = await e2.evaluate(minTenurePack.packId, input);
    expect(a.decisionHash).toBe(b.decisionHash);
  });
});

describe("seeded generator is deterministic (no PII)", () => {
  it("same (count, seed) yields identical records", () => {
    const a = generateWorkforce(500, 42);
    const b = generateWorkforce(500, 42);
    expect(sha256(canonicalJson(a))).toBe(sha256(canonicalJson(b)));
  });
  it("different seeds diverge", () => {
    const a = generateWorkforce(500, 1);
    const b = generateWorkforce(500, 2);
    expect(sha256(canonicalJson(a))).not.toBe(sha256(canonicalJson(b)));
  });
});
