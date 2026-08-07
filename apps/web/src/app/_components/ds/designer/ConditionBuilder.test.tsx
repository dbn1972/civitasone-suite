import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConditionBuilder } from "./ConditionBuilder";
import type { FormFieldDefinition } from "./formTypes";

const fields: FormFieldDefinition[] = [
  { id: "f1", apiName: "business_type", type: "picklist_single", label: "Business type", required: false, sectionId: "s1" },
  { id: "f2", apiName: "gst", type: "text", label: "GST number", required: false, sectionId: "s1" },
];

describe("ConditionBuilder", () => {
  it("adds a visibility rule", () => {
    const onChange = vi.fn();
    render(
      <ConditionBuilder conditions={[]} availableFields={fields} currentFieldId="f2" onChange={onChange} />,
    );
    fireEvent.click(screen.getByText("Add visibility rule"));
    expect(onChange).toHaveBeenCalled();
  });
});
