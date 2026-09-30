import { describe, it, expect } from "vitest";
import {
  APAR_STATUSES,
  APAR_STAGE_GROUPS,
  STAGE_LABEL_KEYS,
  stageLabelKey,
  stageIndex,
  isFinal,
  isRepresentationFiled,
} from "./stages";

describe("apar/stages — GAP-HR-APAR-01", () => {
  it("maps every real backend status to a stage group index (regression guard for the dead-vocabulary bug)", () => {
    for (const status of APAR_STATUSES) {
      const idx = stageIndex(status);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(APAR_STAGE_GROUPS.length);
    }
  });

  it("orders self < reporting < reviewing < accepting < closure", () => {
    expect(stageIndex("self_pending")).toBe(0);
    expect(stageIndex("reporting_officer")).toBe(1);
    expect(stageIndex("reviewing_officer")).toBe(2);
    expect(stageIndex("accepting_authority")).toBe(3);
    expect(stageIndex("disclosed")).toBe(4);
    expect(stageIndex("representation")).toBe(4);
    expect(stageIndex("finalised")).toBe(4);
  });

  it("falls back to stage 0 for an unrecognised/legacy status instead of throwing", () => {
    expect(stageIndex("pending")).toBe(0);
    expect(stageIndex("initiated")).toBe(0);
    expect(stageIndex("")).toBe(0);
  });

  it("stageLabelKey resolves every real status and returns null for a legacy one", () => {
    for (const status of APAR_STATUSES) {
      expect(stageLabelKey(status)).toBe(STAGE_LABEL_KEYS[status]);
    }
    expect(stageLabelKey("pending")).toBeNull();
  });

  it("isFinal is true only for 'finalised'", () => {
    expect(isFinal("finalised")).toBe(true);
    for (const status of APAR_STATUSES) {
      if (status !== "finalised") expect(isFinal(status)).toBe(false);
    }
  });

  it("isRepresentationFiled is true only for 'representation'", () => {
    expect(isRepresentationFiled("representation")).toBe(true);
    for (const status of APAR_STATUSES) {
      if (status !== "representation") expect(isRepresentationFiled(status)).toBe(false);
    }
  });
});
