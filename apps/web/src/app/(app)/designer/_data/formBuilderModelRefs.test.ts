/**
 * GAP-DESIGNER-DETAIL-B2-05: deleting a field that other fields reference in
 * their visibility rules must be confirmable, and the dangling conditions must
 * be removed from the saved rule set.
 */
import { describe, it, expect } from "vitest";
import { fieldReferenceCount, removeDanglingVisibility } from "./formBuilderModel";
import type { FormDesignState, FormFieldDefinition } from "@/app/_components/ds/designer/formTypes";

function field(id: string, extra: Partial<FormFieldDefinition> = {}): FormFieldDefinition {
  return {
    id,
    apiName: id,
    type: "text",
    label: id,
    required: false,
    sectionId: "s1",
    ...extra,
  };
}

function design(fields: FormFieldDefinition[]): FormDesignState {
  return {
    sections: [{ id: "s1", label: "Section", collapsed: false, fieldIds: fields.map((f) => f.id) }],
    fields: Object.fromEntries(fields.map((f) => [f.id, f])),
  } as unknown as FormDesignState;
}

describe("field reference counting (GAP-DESIGNER-DETAIL-B2-05)", () => {
  it("counts fields that reference a field in their visibility conditions", () => {
    const d = design([
      field("a"),
      field("b", { visibility: [{ sourceFieldId: "a", operator: "eq", value: "x" }] }),
      field("c", { visibility: [{ sourceFieldId: "a", operator: "not_empty" }] }),
    ]);
    expect(fieldReferenceCount(d, "a")).toBe(2);
    expect(fieldReferenceCount(d, "b")).toBe(0);
  });

  it("removeDanglingVisibility strips conditions pointing at the deleted field", () => {
    const d = design([
      field("b", { visibility: [{ sourceFieldId: "a", operator: "eq", value: "x" }] }),
      field("c", {
        visibility: [
          { sourceFieldId: "a", operator: "eq", value: "y" },
          { sourceFieldId: "d", operator: "not_empty" },
        ],
      }),
    ]);
    const cleaned = removeDanglingVisibility(d, "a");
    // b had its only condition removed -> visibility undefined
    expect(cleaned.fields.b!.visibility).toBeUndefined();
    // c keeps the condition that pointed at d
    expect(cleaned.fields.c!.visibility).toEqual([{ sourceFieldId: "d", operator: "not_empty" }]);
  });

  it("returns the same design unchanged when nothing references the field", () => {
    const d = design([field("a"), field("b")]);
    expect(removeDanglingVisibility(d, "a")).toBe(d);
  });
});
