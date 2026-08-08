import { describe, expect, it } from "vitest";
import type { FormDesignState } from "@/app/_components/ds/designer/formTypes";
import {
  FIELD_VIRTUALIZE_THRESHOLD,
  addFieldToSection,
  addSection,
  createSection,
  moveFieldToSection,
  moveSection,
  removeSection,
  shouldVirtualizeFields,
  toggleSectionCollapsed,
  totalFieldCount,
  visibleWindow,
} from "./formBuilderModel";

function seed(): FormDesignState {
  return { sections: [createSection("Details")], fields: {} };
}

describe("formBuilderModel", () => {
  it("adds sections and fields to the chosen section", () => {
    let design = seed();
    design = addSection(design, "Documents");
    expect(design.sections).toHaveLength(2);
    const docsId = design.sections[1]!.id;
    const added = addFieldToSection(design, "file", docsId);
    expect(added).not.toBeNull();
    design = added!.design;
    expect(totalFieldCount(design)).toBe(1);
    expect(design.fields[added!.field.id]?.sectionId).toBe(docsId);
    expect(design.sections[1]!.fieldIds).toContain(added!.field.id);
  });

  it("moves fields between sections and removes sections without losing fields", () => {
    let design = seed();
    design = addSection(design, "Extra");
    const a = addFieldToSection(design, "text", design.sections[0]!.id)!;
    design = a.design;
    const target = design.sections[1]!.id;
    design = moveFieldToSection(design, a.field.id, target);
    expect(design.fields[a.field.id]?.sectionId).toBe(target);
    expect(design.sections[0]!.fieldIds).not.toContain(a.field.id);
    expect(design.sections[1]!.fieldIds).toContain(a.field.id);

    const firstId = design.sections[0]!.id;
    design = removeSection(design, target);
    expect(design.sections).toHaveLength(1);
    expect(design.sections[0]!.id).toBe(firstId);
    expect(design.sections[0]!.fieldIds).toContain(a.field.id);
  });

  it("reorders and collapses sections", () => {
    let design = seed();
    design = addSection(design, "B");
    const first = design.sections[0]!.id;
    const second = design.sections[1]!.id;
    design = moveSection(design, second, -1);
    expect(design.sections[0]!.id).toBe(second);
    design = toggleSectionCollapsed(design, first);
    expect(design.sections.find((s) => s.id === first)?.collapsed).toBe(true);
  });

  it("windows large field lists beyond the UX threshold", () => {
    expect(FIELD_VIRTUALIZE_THRESHOLD).toBe(50);
    expect(shouldVirtualizeFields(49)).toBe(false);
    expect(shouldVirtualizeFields(50)).toBe(true);
    const w = visibleWindow(80, 0, 200, 40, 2);
    expect(w.start).toBe(0);
    expect(w.end).toBeLessThan(80);
    expect(w.paddingBottom).toBeGreaterThan(0);
  });
});
