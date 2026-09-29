import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Field } from "./Field";
import { Select } from "./Select";

describe("Select", () => {
  it("renders options as children, like the hand-rolled <select> it replaces", () => {
    render(
      <Select aria-label="Type" value="office" onChange={() => {}}>
        <option value="office">Office</option>
        <option value="branch">Branch</option>
      </Select>,
    );
    const select = screen.getByLabelText("Type") as HTMLSelectElement;
    expect(select.value).toBe("office");
    expect(screen.getByRole("option", { name: "Branch" })).toBeInTheDocument();
  });

  it("picks up id/required/aria-invalid/aria-describedby from an ancestor Field", () => {
    render(
      <Field label="Type" required error="Pick a location type.">
        <Select onChange={() => {}}>
          <option value="office">Office</option>
        </Select>
      </Field>,
    );
    // Regex, not an exact string: the label reads "Type *" once `required` adds its indicator.
    const select = screen.getByLabelText(/type/i) as HTMLSelectElement;
    expect(select).toBeRequired();
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(select.getAttribute("aria-describedby")).toBe(
      screen.getByText("Pick a location type.").id,
    );
  });

  it("fires onChange like a plain controlled select", () => {
    const onChange = vi.fn();
    render(
      <Select aria-label="Type" value="office" onChange={onChange}>
        <option value="office">Office</option>
        <option value="branch">Branch</option>
      </Select>,
    );
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "branch" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
