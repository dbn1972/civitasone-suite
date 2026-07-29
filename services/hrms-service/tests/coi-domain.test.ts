import { describe, it, expect } from "vitest";
import { detectConflicts, type PanelMember } from "../src/modules/recruitment/coi-domain.js";

const M = (memberId: string, memberName: string, over: Partial<PanelMember> = {}): PanelMember => ({ memberId, memberName, ...over });

describe("detectConflicts", () => {
  it("flags an identical name as high", () => {
    const r = detectConflicts({ name: "Ravi Kumar" }, [M("m1", "ravi kumar")]);
    expect(r.flags[0]).toMatchObject({ type: "identical_name", severity: "high" });
    expect(r.hasConflict).toBe(true);
    expect(r.highestSeverity).toBe("high");
  });

  it("flags an identical name regardless of token order or commas (Indian name variants)", () => {
    expect(detectConflicts({ name: "Ravi Kumar" }, [M("m1", "Kumar Ravi")]).flags[0]).toMatchObject({ type: "identical_name" });
    expect(detectConflicts({ name: "Sharma, Priya" }, [M("m1", "Priya Sharma")]).flags[0]).toMatchObject({ type: "identical_name" });
  });

  it("flags a shared name token as medium (possible relative)", () => {
    const r = detectConflicts({ name: "Asha Kumar" }, [M("m1", "Bala Kumar")]);
    expect(r.flags.map((f) => f.type)).toEqual(["shared_name_token"]);
    expect(r.flags[0]!.severity).toBe("medium");
  });

  it("does not flag when no name token is shared", () => {
    const r = detectConflicts({ name: "Asha Rao" }, [M("m1", "Bala Kumar")]);
    expect(r.flags).toEqual([]);
    expect(r.hasConflict).toBe(false);
    expect(r.highestSeverity).toBeNull();
  });

  it("does not match on single-letter initials", () => {
    // "A Kumar" vs "B Sharma" share only the initial-length tokens which are dropped
    const r = detectConflicts({ name: "A Sharma" }, [M("m1", "B Kumar")]);
    expect(r.flags).toEqual([]);
  });

  it("flags a shared phone regardless of formatting (last 10 digits)", () => {
    const r = detectConflicts({ name: "A B", phone: "+91-98765 43210" }, [M("m1", "C D", { phone: "9876543210" })]);
    expect(r.flags.map((f) => f.type)).toContain("shared_phone");
    expect(r.flags.find((f) => f.type === "shared_phone")!.severity).toBe("high");
  });

  it("does not match on a too-short phone", () => {
    const r = detectConflicts({ name: "A B", phone: "12345" }, [M("m1", "C D", { phone: "12345" })]);
    expect(r.flags.some((f) => f.type === "shared_phone")).toBe(false);
  });

  it("flags a shared email (case-insensitive) as high", () => {
    const r = detectConflicts({ name: "A B", email: "X@Y.in" }, [M("m1", "C D", { email: "x@y.in" })]);
    expect(r.flags.map((f) => f.type)).toContain("shared_email");
  });

  it("flags a shared institution as low", () => {
    const r = detectConflicts({ name: "A B", institutions: ["IIT Delhi"] }, [M("m1", "C D", { institution: "iit delhi" })]);
    expect(r.flags.map((f) => f.type)).toEqual(["shared_institution"]);
    expect(r.flags[0]!.severity).toBe("low");
    expect(r.hasConflict).toBe(false); // only a low flag -> not a blocking conflict
  });

  it("surfaces a panelist's self-declared conflict as high", () => {
    const r = detectConflicts({ name: "Zed Alpha" }, [M("m1", "Yan Beta", { declaredCoi: true, coiNote: "knows candidate personally" })]);
    expect(r.flags.map((f) => f.type)).toContain("declared_conflict");
  });

  it("does NOT flag a declared conflict from a note alone (avoids high-severity false positives)", () => {
    const r = detectConflicts({ name: "Zed Alpha" }, [M("m1", "Yan Beta", { declaredCoi: false, coiNote: "reviewed CV, no known relation" })]);
    expect(r.flags.some((f) => f.type === "declared_conflict")).toBe(false);
  });

  it("raises multiple flags for one member and reports the highest severity", () => {
    const r = detectConflicts(
      { name: "Ravi Kumar", phone: "9998887776", institutions: ["DU"] },
      [M("m1", "Sita Kumar", { phone: "9998887776", institution: "DU" })],
    );
    const types = r.flags.map((f) => f.type).sort();
    expect(types).toEqual(["shared_institution", "shared_name_token", "shared_phone"]);
    expect(r.highestSeverity).toBe("high"); // phone match dominates
  });
});
