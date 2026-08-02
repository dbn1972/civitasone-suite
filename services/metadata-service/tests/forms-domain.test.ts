/**
 * Unit tests for the pure forms-engine domain (FRM-04 cascades, FRM-05
 * visibility). No database, no Fastify — these exercise every branch of the
 * cycle detector, the visibility evaluator and the cascade resolver.
 */
import { describe, it, expect } from "vitest";
import {
  applyVisibility,
  findCascadeCycle,
  findCascadeViolations,
  resolveCascadeOptions,
  validateCascadeRules,
  validateFormSubmission,
  validateVisibilityRules,
  type CascadeRule,
  type VisibilityRule,
} from "../src/modules/forms/domain.js";
import type { FieldDef } from "../src/modules/rules/domain.js";

const stateDistrict: CascadeRule[] = [
  {
    field: "district",
    dependsOn: "state",
    options: { MH: ["Pune", "Nagpur"], KA: ["Bengaluru", "Mysuru"] },
  },
];

describe("FRM-04 cycle detection (findCascadeCycle)", () => {
  it("returns null for an empty rule set", () => {
    expect(findCascadeCycle([])).toBeNull();
  });

  it("returns null for a simple acyclic cascade", () => {
    expect(findCascadeCycle(stateDistrict)).toBeNull();
  });

  it("returns null for a 3-level chain (taluka <- district <- state)", () => {
    const rules: CascadeRule[] = [
      { field: "taluka", dependsOn: "district", options: { Pune: ["Haveli"] } },
      { field: "district", dependsOn: "state", options: { MH: ["Pune"] } },
    ];
    expect(findCascadeCycle(rules)).toBeNull();
  });

  it("detects a direct two-field cycle A <- B, B <- A", () => {
    const rules: CascadeRule[] = [
      { field: "a", dependsOn: "b", options: { x: ["1"] } },
      { field: "b", dependsOn: "a", options: { y: ["2"] } },
    ];
    const cycle = findCascadeCycle(rules);
    expect(cycle).not.toBeNull();
    // The path closes on itself: first and last element are the same node.
    expect(cycle?.[0]).toBe(cycle?.[cycle.length - 1]);
    expect(new Set(cycle)).toEqual(new Set(["a", "b"]));
  });

  it("detects a self-loop A <- A", () => {
    expect(findCascadeCycle([{ field: "a", dependsOn: "a", options: { x: ["1"] } }])).toEqual(["a", "a"]);
  });

  it("detects a three-field cycle A <- B <- C <- A", () => {
    const rules: CascadeRule[] = [
      { field: "a", dependsOn: "b", options: { x: ["1"] } },
      { field: "b", dependsOn: "c", options: { x: ["1"] } },
      { field: "c", dependsOn: "a", options: { x: ["1"] } },
    ];
    expect(findCascadeCycle(rules)).not.toBeNull();
  });

  it("does not report a cycle for a diamond (two fields sharing one parent)", () => {
    const rules: CascadeRule[] = [
      { field: "district", dependsOn: "state", options: { MH: ["Pune"] } },
      { field: "language", dependsOn: "state", options: { MH: ["Marathi"] } },
    ];
    expect(findCascadeCycle(rules)).toBeNull();
  });

  it("handles a field with two parent edges without false positives", () => {
    // Duplicate rules for the same field are a separate error; the graph walk
    // must still terminate and must not invent a cycle.
    const rules: CascadeRule[] = [
      { field: "a", dependsOn: "b", options: { x: ["1"] } },
      { field: "a", dependsOn: "c", options: { x: ["1"] } },
    ];
    expect(findCascadeCycle(rules)).toBeNull();
  });
});

describe("FRM-04 definition-time validation (validateCascadeRules)", () => {
  it("accepts a valid rule set against known fields", () => {
    const result = validateCascadeRules(stateDistrict, ["state", "district"]);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.cycle).toBeUndefined();
  });

  it("rejects a cyclic rule set and reports the cycle path", () => {
    const rules: CascadeRule[] = [
      { field: "a", dependsOn: "b", options: { x: ["1"] } },
      { field: "b", dependsOn: "a", options: { x: ["1"] } },
    ];
    const result = validateCascadeRules(rules, ["a", "b"]);
    expect(result.valid).toBe(false);
    expect(result.cycle).toBeDefined();
    expect(result.errors.some((e) => e.includes("cycle"))).toBe(true);
  });

  it("rejects self-dependency with a dedicated message", () => {
    const result = validateCascadeRules([{ field: "a", dependsOn: "a", options: { x: ["1"] } }], ["a"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("cannot depend on itself"))).toBe(true);
  });

  it("rejects an unknown dependent field", () => {
    const result = validateCascadeRules(stateDistrict, ["state"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown field "district"'))).toBe(true);
  });

  it("rejects an unknown parent field", () => {
    const result = validateCascadeRules(stateDistrict, ["district"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown parent field "state"'))).toBe(true);
  });

  it("rejects duplicate rules for the same field", () => {
    const rules: CascadeRule[] = [
      { field: "district", dependsOn: "state", options: { MH: ["Pune"] } },
      { field: "district", dependsOn: "country", options: { IN: ["Pune"] } },
    ];
    const result = validateCascadeRules(rules, ["district", "state", "country"]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("duplicate cascade rule"))).toBe(true);
  });

  it("rejects an empty option map", () => {
    const result = validateCascadeRules([{ field: "district", dependsOn: "state", options: {} }], [
      "district",
      "state",
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("no option mappings"))).toBe(true);
  });

  it("skips the existence check when no known fields are supplied", () => {
    expect(validateCascadeRules(stateDistrict).valid).toBe(true);
  });
});

describe("FRM-04 server-side resolution (resolveCascadeOptions)", () => {
  it("returns an empty option list while the parent is unset", () => {
    const [resolved] = resolveCascadeOptions(stateDistrict, {});
    expect(resolved?.parentValue).toBeNull();
    expect(resolved?.options).toEqual([]);
  });

  it("treats an empty-string parent as unset", () => {
    const [resolved] = resolveCascadeOptions(stateDistrict, { state: "" });
    expect(resolved?.parentValue).toBeNull();
  });

  it("treats a null parent as unset", () => {
    const [resolved] = resolveCascadeOptions(stateDistrict, { state: null });
    expect(resolved?.parentValue).toBeNull();
  });

  it("narrows options to the chosen parent value", () => {
    const [resolved] = resolveCascadeOptions(stateDistrict, { state: "MH" });
    expect(resolved?.options).toEqual(["Pune", "Nagpur"]);
  });

  it("returns an empty list for a parent value with no mapping", () => {
    const [resolved] = resolveCascadeOptions(stateDistrict, { state: "ZZ" });
    expect(resolved?.parentValue).toBe("ZZ");
    expect(resolved?.options).toEqual([]);
  });

  it("stringifies a non-string parent value", () => {
    const rules: CascadeRule[] = [{ field: "b", dependsOn: "a", options: { "1": ["one"] } }];
    expect(resolveCascadeOptions(rules, { a: 1 })[0]?.options).toEqual(["one"]);
  });
});

describe("FRM-04 cascade violations (findCascadeViolations)", () => {
  it("accepts a value inside the resolved options", () => {
    expect(findCascadeViolations(stateDistrict, { state: "MH", district: "Pune" })).toEqual([]);
  });

  it("rejects a value belonging to a different parent", () => {
    const errors = findCascadeViolations(stateDistrict, { state: "MH", district: "Bengaluru" });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('not a valid option for state="MH"');
  });

  it("rejects a dependent value while the parent is unset", () => {
    const errors = findCascadeViolations(stateDistrict, { district: "Pune" });
    expect(errors[0]).toContain("cannot be set until");
  });

  it("ignores an absent dependent value", () => {
    expect(findCascadeViolations(stateDistrict, { state: "MH" })).toEqual([]);
  });

  it("ignores an empty-string dependent value", () => {
    expect(findCascadeViolations(stateDistrict, { state: "MH", district: "" })).toEqual([]);
  });
});

describe("FRM-05 visibility rule validation", () => {
  it("accepts a well-formed rule", () => {
    expect(validateVisibilityRules([{ field: "gstin", showWhen: 'entity_type == "company"' }], ["gstin", "entity_type"])).toEqual([]);
  });

  it("rejects an unknown field", () => {
    const errors = validateVisibilityRules([{ field: "ghost", showWhen: "a == 1" }], ["a"]);
    expect(errors.some((e) => e.includes('unknown field "ghost"'))).toBe(true);
  });

  it("rejects an empty condition", () => {
    const errors = validateVisibilityRules([{ field: "a", showWhen: "   " }], ["a"]);
    expect(errors.some((e) => e.includes("empty condition"))).toBe(true);
  });

  it("rejects a self-referential condition", () => {
    const errors = validateVisibilityRules([{ field: "a", showWhen: "a == 1" }], ["a"]);
    expect(errors.some((e) => e.includes("references its own field"))).toBe(true);
  });

  it("does not treat a field name that is a prefix of another as self-reference", () => {
    // "state" must not match inside "state_code".
    expect(validateVisibilityRules([{ field: "state", showWhen: 'state_code == "MH"' }], ["state", "state_code"])).toEqual([]);
  });

  it("rejects duplicate rules for the same field", () => {
    const errors = validateVisibilityRules(
      [
        { field: "a", showWhen: "b == 1" },
        { field: "a", showWhen: "c == 1" },
      ],
      ["a", "b", "c"],
    );
    expect(errors.some((e) => e.includes("duplicate visibility rule"))).toBe(true);
  });

  it("skips the existence check when no known fields are supplied", () => {
    expect(validateVisibilityRules([{ field: "anything", showWhen: "b == 1" }])).toEqual([]);
  });
});

describe("FRM-05 visibility evaluation (applyVisibility)", () => {
  const rules: VisibilityRule[] = [{ field: "gstin", showWhen: 'entity_type == "company"' }];

  it("shows a field with no rule", () => {
    const out = applyVisibility(["name"], [], { name: "x" });
    expect(out.visible).toEqual(["name"]);
    expect(out.hidden).toEqual([]);
  });

  it("shows a conditional field when the condition holds", () => {
    const out = applyVisibility(["entity_type", "gstin"], rules, { entity_type: "company" });
    expect(out.visible).toContain("gstin");
    expect(out.hidden).toEqual([]);
  });

  it("hides a conditional field when the condition does not hold", () => {
    const out = applyVisibility(["entity_type", "gstin"], rules, { entity_type: "individual" });
    expect(out.hidden).toEqual(["gstin"]);
  });

  it("strips a hidden field's submitted value and reports the strip", () => {
    const out = applyVisibility(["entity_type", "gstin"], rules, {
      entity_type: "individual",
      gstin: "27AAAAA0000A1Z5",
    });
    expect(out.stripped).toEqual(["gstin"]);
    expect(out.values).toEqual({ entity_type: "individual" });
    expect("gstin" in out.values).toBe(false);
  });

  it("keeps values for fields that are not part of any rule", () => {
    const out = applyVisibility(["a"], [], { a: 1, extra: 2 });
    expect(out.values).toEqual({ a: 1, extra: 2 });
    expect(out.stripped).toEqual([]);
  });

  it("fails closed: a rule referencing missing data hides the field", () => {
    const out = applyVisibility(["gstin"], rules, {});
    expect(out.hidden).toEqual(["gstin"]);
  });

  it("evaluates conditions against the pre-strip values so rule order is irrelevant", () => {
    // `b` is hidden; `c` depends on `b`'s submitted value. Because evaluation
    // happens before stripping, `c` is still shown.
    const twoRules: VisibilityRule[] = [
      { field: "b", showWhen: "never_true == 1" },
      { field: "c", showWhen: "b == 5" },
    ];
    const out = applyVisibility(["b", "c"], twoRules, { b: 5 });
    expect(out.hidden).toEqual(["b"]);
    expect(out.visible).toEqual(["c"]);
  });
});

describe("FRM-05 submission validation (validateFormSubmission)", () => {
  const fields: FieldDef[] = [
    { apiName: "entity_type", fieldType: "text", isRequired: true, label: "Entity type" },
    { apiName: "gstin", fieldType: "text", isRequired: true, label: "GSTIN" },
  ];
  const rules: VisibilityRule[] = [{ field: "gstin", showWhen: 'entity_type == "company"' }];

  it("a HIDDEN REQUIRED field does not block the submission", () => {
    const result = validateFormSubmission(fields, rules, [], { entity_type: "individual" });
    expect(result.errors).toEqual([]);
    expect(result.hidden).toEqual(["gstin"]);
  });

  it("a VISIBLE required field still blocks the submission when missing", () => {
    const result = validateFormSubmission(fields, rules, [], { entity_type: "company" });
    expect(result.errors.some((e) => e.includes("GSTIN is required"))).toBe(true);
  });

  it("a hidden field's submitted value is STRIPPED, never persisted", () => {
    const result = validateFormSubmission(fields, rules, [], {
      entity_type: "individual",
      gstin: "spoofed",
    });
    expect(result.stripped).toEqual(["gstin"]);
    expect(result.values.gstin).toBeUndefined();
    expect(result.errors).toEqual([]);
  });

  it("enforces cascade membership on visible fields", () => {
    const cascadeFields: FieldDef[] = [
      { apiName: "state", fieldType: "text", isRequired: true },
      { apiName: "district", fieldType: "text", isRequired: false },
    ];
    const result = validateFormSubmission(cascadeFields, [], stateDistrict, {
      state: "MH",
      district: "Mysuru",
    });
    expect(result.errors).toHaveLength(1);
  });

  it("does not enforce a cascade whose target field is hidden", () => {
    const cascadeFields: FieldDef[] = [
      { apiName: "state", fieldType: "text", isRequired: true },
      { apiName: "district", fieldType: "text", isRequired: false },
    ];
    const hideDistrict: VisibilityRule[] = [{ field: "district", showWhen: "never == 1" }];
    const result = validateFormSubmission(cascadeFields, hideDistrict, stateDistrict, {
      state: "MH",
      district: "Mysuru",
    });
    expect(result.errors).toEqual([]);
    expect(result.stripped).toEqual(["district"]);
  });

  it("accepts a fully valid submission", () => {
    const result = validateFormSubmission(fields, rules, [], {
      entity_type: "company",
      gstin: "27AAAAA0000A1Z5",
    });
    expect(result.errors).toEqual([]);
    expect(result.values).toEqual({ entity_type: "company", gstin: "27AAAAA0000A1Z5" });
  });
});
