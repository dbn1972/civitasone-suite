import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Field } from "./Field";
import { Textarea } from "./Textarea";

describe("Textarea", () => {
  it("renders a <textarea> and forwards value/onChange/rows like the hand-rolled version it replaces", () => {
    const onChange = vi.fn();
    render(<Textarea aria-label="Description" value="hello" onChange={onChange} rows={4} />);
    const textarea = screen.getByLabelText("Description") as HTMLTextAreaElement;
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea.value).toBe("hello");
    expect(textarea).toHaveAttribute("rows", "4");
    fireEvent.change(textarea, { target: { value: "hello world" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("defaults to resize: none, matching the hand-rolled convention", () => {
    render(<Textarea aria-label="Description" />);
    expect(screen.getByLabelText("Description").style.resize).toBe("none");
  });

  it("picks up id/aria-invalid/aria-describedby from an ancestor Field", () => {
    render(
      <Field label="Description" error="Must be at least 20 characters.">
        <Textarea />
      </Field>,
    );
    const textarea = screen.getByLabelText("Description");
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    expect(textarea.getAttribute("aria-describedby")).toBe(
      screen.getByText("Must be at least 20 characters.").id,
    );
  });
});
