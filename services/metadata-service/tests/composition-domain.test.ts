/**
 * CAP-111 / CAP-114 — module composition validator (pure).
 */
import { describe, it, expect } from "vitest";
import { validateComposition, type CompositionRefs } from "../src/modules/composition/domain.js";

const refs: CompositionRefs = {
  entityApiNames: new Set(["vehicle", "driver"]),
  layoutIds: new Set(["11111111-1111-4111-8111-111111111111"]),
  workflowKeys: new Set(["approval_flow"]),
};

describe("validateComposition", () => {
  it("accepts a valid composition", () => {
    const r = validateComposition({
      entities: ["vehicle", "driver"],
      layouts: [{ entity: "vehicle", layoutId: "11111111-1111-4111-8111-111111111111" }],
      workflows: ["approval_flow"],
      navigation: [{ entity: "vehicle", label: "Vehicles", order: 1 }],
    }, refs);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("requires at least one entity", () => {
    const r = validateComposition({ entities: [] }, refs);
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toContain("at least one entity");
  });

  it("rejects unknown entity", () => {
    const r = validateComposition({ entities: ["ghost"] }, refs);
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toContain("unknown entity: ghost");
  });

  it("rejects invalid apiName", () => {
    const r = validateComposition({ entities: ["Bad Name"] }, refs);
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toContain("invalid entity apiName");
  });

  it("flags duplicate entities", () => {
    const r = validateComposition({ entities: ["vehicle", "vehicle"] }, refs);
    expect(r.errors.join()).toContain("duplicate entity");
  });

  it("rejects layout referencing entity not in composition", () => {
    const r = validateComposition({
      entities: ["vehicle"],
      layouts: [{ entity: "driver", layoutId: "11111111-1111-4111-8111-111111111111" }],
    }, refs);
    expect(r.errors.join()).toContain("layout references entity not in composition");
  });

  it("rejects unknown layout id", () => {
    const r = validateComposition({
      entities: ["vehicle"],
      layouts: [{ entity: "vehicle", layoutId: "99999999-9999-4999-8999-999999999999" }],
    }, refs);
    expect(r.errors.join()).toContain("unknown layout");
  });

  it("rejects navigation to entity not in composition", () => {
    const r = validateComposition({
      entities: ["vehicle"],
      navigation: [{ entity: "driver", label: "Drivers" }],
    }, refs);
    expect(r.errors.join()).toContain("navigation references entity not in composition");
  });

  it("rejects unknown workflow key", () => {
    const r = validateComposition({ entities: ["vehicle"], workflows: ["nope"] }, refs);
    expect(r.errors.join()).toContain("unknown workflow: nope");
  });
});
