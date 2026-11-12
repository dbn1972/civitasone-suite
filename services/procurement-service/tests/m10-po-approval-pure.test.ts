/**
 * M10 (procurement without Finance): the pure parts -- the threshold matrix and
 * the approval-mode derivation. No database.
 */
import { describe, it, expect, afterEach } from "vitest";
import { DEFAULT_MATRIX, validateMatrix, bandFor, approvalDecision, wireBands, MAX_BANDS, type MatrixBand } from "../src/modules/po-approval/matrix.js";
import { effectiveApprovalMode, isApprovalMode } from "../src/modules/po-approval/mode.js";
import { tenantHasModule, setModuleKeyFetcher, warnIfModuleLookupUnconfigured } from "../src/shared/tenant-modules.js";

const T = "11111111-2222-4333-8444-555555555555";
const matrix: MatrixBand[] = [
  { upToMinor: 5_000_000n, approverRoles: ["procurement_officer", "procurement_admin"] },
  { upToMinor: 100_000_000n, approverRoles: ["procurement_admin"] },
  { upToMinor: null, approverRoles: ["super_admin"] },
];

describe("effectiveApprovalMode", () => {
  it("a tenant with Finance and no override keeps the sanction path (every existing tenant)", () => {
    expect(effectiveApprovalMode(null, true)).toEqual({ mode: "finance_sanction", source: "derived" });
    expect(effectiveApprovalMode(undefined, true)).toEqual({ mode: "finance_sanction", source: "derived" });
  });
  it("a tenant without Finance derives local approval", () => {
    expect(effectiveApprovalMode(null, false)).toEqual({ mode: "local", source: "derived" });
  });
  it("an explicit override wins either way; an unknown stored value is ignored", () => {
    expect(effectiveApprovalMode("local", true)).toEqual({ mode: "local", source: "override" });
    expect(effectiveApprovalMode("finance_sanction", false)).toEqual({ mode: "finance_sanction", source: "override" });
    expect(effectiveApprovalMode("nonsense", true)).toEqual({ mode: "finance_sanction", source: "derived" });
    expect(isApprovalMode("local")).toBe(true);
    expect(isApprovalMode("LOCAL")).toBe(false);
  });
});

describe("tenantHasModule (fails towards today's behaviour)", () => {
  afterEach(() => setModuleKeyFetcher());
  it("reads the module list", async () => {
    setModuleKeyFetcher(async () => ["procurement", "hrms"]);
    expect(await tenantHasModule(T, "finance")).toBe(false);
    expect(await tenantHasModule(T, "procurement")).toBe(true);
  });
  it("an unknown answer (null), a throw or a malformed tenant id all mean the tenant has it", async () => {
    setModuleKeyFetcher(async () => null);
    expect(await tenantHasModule(T, "finance")).toBe(true);
    setModuleKeyFetcher(async () => { throw new Error("boom"); });
    expect(await tenantHasModule(T, "finance")).toBe(true);
    expect(await tenantHasModule("not-a-uuid", "finance")).toBe(true);
  });
  it("a body that is not the module projection is unknown, not 'no modules'", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ available: "100" }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    try {
      setModuleKeyFetcher();
      expect(await tenantHasModule(T, "finance")).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("validateMatrix", () => {
  it("accepts the default and a one-band matrix", () => {
    expect(validateMatrix(DEFAULT_MATRIX)).toEqual([]);
    expect(validateMatrix([{ upToMinor: null, approverRoles: ["procurement_admin"] }])).toEqual([]);
  });
  it("needs bands, an unbounded last band and strictly increasing limits", () => {
    expect(validateMatrix([])).toHaveLength(1);
    expect(validateMatrix([{ upToMinor: 100n, approverRoles: ["procurement_admin"] }])[0]).toMatch(/last.*no upper limit/);
    expect(validateMatrix([{ upToMinor: null, approverRoles: ["procurement_admin"] }, { upToMinor: null, approverRoles: ["super_admin"] }]).join(" ")).toMatch(/only the last band/);
    expect(validateMatrix([
      { upToMinor: 500n, approverRoles: ["procurement_admin"] }, { upToMinor: 500n, approverRoles: ["procurement_admin"] }, { upToMinor: null, approverRoles: ["super_admin"] },
    ]).join(" ")).toMatch(/band 2: the limit must be above/);
  });
  it("names real approver roles, at least one, no duplicates, and caps the band count", () => {
    expect(validateMatrix([{ upToMinor: null, approverRoles: [] }]).join(" ")).toMatch(/at least one approver role/);
    expect(validateMatrix([{ upToMinor: null, approverRoles: ["finance_officer"] }]).join(" ")).toMatch(/not a procurement approver role/);
    expect(validateMatrix([{ upToMinor: null, approverRoles: ["procurement_admin", "procurement_admin"] }]).join(" ")).toMatch(/listed twice/);
    const many: MatrixBand[] = Array.from({ length: MAX_BANDS + 1 }, (_, i) => ({ upToMinor: i === MAX_BANDS ? null : BigInt(i + 1) * 100n, approverRoles: ["procurement_admin"] }));
    expect(validateMatrix(many).join(" ")).toMatch(/at most/);
  });
});

describe("approval decision", () => {
  it("a value falls in the first band whose limit it does not exceed (the limit itself is in the lower band)", () => {
    expect(bandFor(5_000_000n, matrix).upToMinor).toBe(5_000_000n);
    expect(bandFor(5_000_001n, matrix).upToMinor).toBe(100_000_000n);
    expect(bandFor(100_000_000n, matrix).upToMinor).toBe(100_000_000n);
    expect(bandFor(100_000_001n, matrix).upToMinor).toBeNull();
    expect(bandFor(1n, matrix).upToMinor).toBe(5_000_000n);
  });
  it("an officer may approve the low band only; an admin the low and middle; the top band needs a super admin", () => {
    expect(approvalDecision(5_000_000n, ["procurement_officer"], matrix).ok).toBe(true);
    expect(approvalDecision(5_000_001n, ["procurement_officer"], matrix).ok).toBe(false);
    expect(approvalDecision(5_000_001n, ["procurement_admin"], matrix).ok).toBe(true);
    expect(approvalDecision(100_000_001n, ["procurement_admin"], matrix).ok).toBe(false);
    expect(approvalDecision(100_000_001n, ["procurement_admin", "super_admin"], matrix).ok).toBe(true);
  });
  it("super_admin is always allowed and is named among the required roles", () => {
    const d = approvalDecision(5_000_001n, ["audit_officer"], matrix);
    expect(d.ok).toBe(false);
    expect(d.requiredRoles).toEqual(["procurement_admin", "super_admin"]);
    expect(approvalDecision(5_000_001n, ["super_admin"], matrix).ok).toBe(true);
  });
  it("a role that is not in the band never approves, even alongside unrelated roles", () => {
    expect(approvalDecision(10n, ["finance_officer", "audit_officer"], matrix).ok).toBe(false);
  });
  it("wireBands renders limits as paise strings", () => {
    expect(wireBands(matrix)).toEqual([
      { upToMinor: "5000000", approverRoles: ["procurement_officer", "procurement_admin"] },
      { upToMinor: "100000000", approverRoles: ["procurement_admin"] },
      { upToMinor: null, approverRoles: ["super_admin"] },
    ]);
  });
});

describe("warnIfModuleLookupUnconfigured", () => {
  const saved = process.env.INTERNAL_SERVICE_SECRET;
  afterEach(() => { if (saved === undefined) delete process.env.INTERNAL_SERVICE_SECRET; else process.env.INTERNAL_SERVICE_SECRET = saved; });

  it("says clearly, at boot, that local approval will not engage without INTERNAL_SERVICE_SECRET", () => {
    delete process.env.INTERNAL_SERVICE_SECRET;
    const calls: Array<[object, string]> = [];
    warnIfModuleLookupUnconfigured({ warn: (o, m) => { calls.push([o, m]); } });
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toMatch(/INTERNAL_SERVICE_SECRET is not set.*treated as having Finance.*explicit override/);
  });
  it("is silent when the secret is set", () => {
    process.env.INTERNAL_SERVICE_SECRET = "x";
    const calls: unknown[] = [];
    warnIfModuleLookupUnconfigured({ warn: () => { calls.push(1); } });
    expect(calls).toEqual([]);
  });
});
