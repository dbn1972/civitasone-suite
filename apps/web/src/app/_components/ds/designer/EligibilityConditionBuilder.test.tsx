import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EligibilityConditionBuilder } from "./EligibilityConditionBuilder";
import type { FormFieldDefinition } from "./formTypes";

const fields: FormFieldDefinition[] = [
  { id: "f1", apiName: "business_type", type: "picklist_single", label: "Business type", required: false, sectionId: "s1" },
];

describe("EligibilityConditionBuilder", () => {
  it("shows skippable empty state copy", () => {
    render(
      <EligibilityConditionBuilder rules={[]} formFields={fields} onChange={vi.fn()} />,
    );
    expect(screen.getByText(/everyone may apply/i)).toBeInTheDocument();
  });

  it("adds an eligibility condition", () => {
    const onChange = vi.fn();
    render(
      <EligibilityConditionBuilder rules={[]} formFields={fields} onChange={onChange} />,
    );
    fireEvent.click(screen.getByText("Add condition"));
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0]![0] as unknown[];
    expect(next).toHaveLength(1);
  });

  it("highlights failing sample rules", () => {
    render(
      <EligibilityConditionBuilder
        rules={[
          {
            id: "r-fail",
            attribute: "age",
            op: "gte",
            value: "60",
            effect: "block",
            message: "Senior only",
          },
        ]}
        formFields={fields}
        onChange={vi.fn()}
        ruleHighlights={{ "r-fail": "fail" }}
      />,
    );
    expect(screen.getByText("Fails sample")).toBeInTheDocument();
    expect(screen.getByTestId("eligibility-rule-r-fail")).toHaveAttribute("data-highlight", "fail");
  });
});
