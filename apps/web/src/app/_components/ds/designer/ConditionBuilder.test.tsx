import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConditionBuilder } from "./ConditionBuilder";
import type { FormFieldDefinition, VisibilityCondition } from "./formTypes";

const fields: FormFieldDefinition[] = [
  { id: "f1", apiName: "business_type", type: "picklist_single", label: "Business type", required: false, sectionId: "s1" },
  { id: "f2", apiName: "gst", type: "text", label: "GST number", required: false, sectionId: "s1" },
  { id: "f3", apiName: "pan", type: "text", label: "PAN", required: false, sectionId: "s1" },
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

  // A stateful wrapper: ConditionBuilder is fully controlled
  // (conditions/onChange), so proving the fix needs a real add/remove
  // round-trip, not just a mocked onChange -- same approach as
  // LineItemsEditor.test.tsx's StatefulEditor.
  function StatefulBuilder() {
    const [conditions, setConditions] = useState<VisibilityCondition[]>([]);
    return (
      <ConditionBuilder
        conditions={conditions}
        availableFields={fields}
        currentFieldId="f3"
        onChange={setConditions}
      />
    );
  }

  // Row identity: condition rows were keyed by array position, so removing
  // an earlier row shifted later ones up into a different key -- React
  // patched the focused row's DOM node in place with a different row's data
  // instead of removing the right node and leaving the rest (and focus)
  // alone.
  it("keeps a condition's own value and focus attached to it after an earlier condition is removed", () => {
    render(<StatefulBuilder />);
    fireEvent.click(screen.getByText("Add visibility rule"));
    fireEvent.click(screen.getByText("Add visibility rule"));
    fireEvent.click(screen.getByText("Add visibility rule"));

    const thirdValue = screen.getAllByLabelText("Comparison value")[2]!;
    fireEvent.change(thirdValue, { target: { value: "acme" } });
    thirdValue.focus();
    expect(document.activeElement).toBe(thirdValue);

    // Remove the first condition -- conditions 2-3 shift up to become 1-2.
    fireEvent.click(screen.getAllByText("Remove rule")[0]!);

    const survivingThirdValue = screen.getAllByLabelText("Comparison value")[1]!;
    expect(survivingThirdValue).toHaveValue("acme");
    expect(document.activeElement).toBe(survivingThirdValue);
  });

  // This builder is reused live for whichever field is currently selected
  // in FormBuilder's property panel -- it is never unmounted between
  // selections, so the id list must reseed when currentFieldId changes
  // (React's documented "adjust state when a prop changes" pattern), not
  // just on add/remove. Without that reseed, switching to a field with a
  // differently-sized condition list desyncs the id array, and a later
  // removal there can still eject focus from a surviving row.
  it("keeps a condition's value and focus after switching to a different field and removing an earlier row there", () => {
    function Wrapper() {
      const [fieldId, setFieldId] = useState("f1");
      const [byField, setByField] = useState<Record<string, VisibilityCondition[]>>({
        f1: [{ sourceFieldId: "f2", operator: "eq", value: "x" }],
        f3: [
          { sourceFieldId: "f1", operator: "eq", value: "a" },
          { sourceFieldId: "f1", operator: "eq", value: "b" },
        ],
      });
      return (
        <div>
          <button onClick={() => setFieldId("f3")}>switch field</button>
          <ConditionBuilder
            conditions={byField[fieldId] ?? []}
            availableFields={fields}
            currentFieldId={fieldId}
            onChange={(next) => setByField((prev) => ({ ...prev, [fieldId]: next }))}
          />
        </div>
      );
    }
    render(<Wrapper />);
    // Start on field f1 (1 condition), then switch to field f3 (2 conditions).
    fireEvent.click(screen.getByText("switch field"));

    const secondValue = screen.getAllByLabelText("Comparison value")[1]!;
    secondValue.focus();
    expect(secondValue).toHaveValue("b");
    expect(document.activeElement).toBe(secondValue);

    // Remove the first (now-visible) condition -- the second must keep its
    // own value and focus, not be torn down and remounted as a new node.
    fireEvent.click(screen.getAllByText("Remove rule")[0]!);

    const survivingValue = screen.getAllByLabelText("Comparison value")[0]!;
    expect(survivingValue).toHaveValue("b");
    expect(document.activeElement).toBe(survivingValue);
  });
});
