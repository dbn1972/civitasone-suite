import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Field } from "./Field";
import { Input } from "./Input";

describe("Field", () => {
  it("associates the label with its control (label + input, via htmlFor/id)", () => {
    render(
      <Field label="Code">
        <Input placeholder="e.g. FIN" />
      </Field>,
    );
    const input = screen.getByLabelText("Code");
    expect(input).toBeInTheDocument();
    expect(input.tagName).toBe("INPUT");
  });

  it("does not render a required indicator or aria-required when required is omitted", () => {
    render(
      <Field label="Pay grade">
        <Input />
      </Field>,
    );
    expect(screen.getByText("Pay grade").textContent).toBe("Pay grade");
    expect(screen.getByLabelText("Pay grade")).not.toHaveAttribute("aria-required", "true");
    expect(screen.getByLabelText("Pay grade")).not.toBeRequired();
  });

  it("renders a required indicator and marks the control required/aria-required", () => {
    render(
      <Field label="Code" required>
        <Input />
      </Field>,
    );
    // The visible label text plus the (aria-hidden) asterisk.
    expect(screen.getByText("*", { exact: true })).toBeInTheDocument();
    const input = screen.getByLabelText(/code/i);
    expect(input).toBeRequired();
    expect(input).toHaveAttribute("aria-required", "true");
  });

  it("has no error message and no aria-invalid/aria-describedby when error is unset", () => {
    render(
      <Field label="Name">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText("Name");
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
  });

  it("renders the error message and wires aria-invalid + aria-describedby to it", () => {
    render(
      <Field label="Code" error="Department code already exists.">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText("Code");
    const error = screen.getByText("Department code already exists.");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input.getAttribute("aria-describedby")).toBe(error.id);
  });

  it("propagates disabled to the wrapped control", () => {
    render(
      <Field label="Code" disabled>
        <Input />
      </Field>,
    );
    expect(screen.getByLabelText("Code")).toBeDisabled();
  });

  it("uses an explicit Field id for both the label's htmlFor and the control's id", () => {
    render(
      <Field id="explicit-id" label="Code">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText("Code");
    expect(input).toHaveAttribute("id", "explicit-id");
    expect(screen.getByText("Code")).toHaveAttribute("for", "explicit-id");
  });

  it("always announces the inline error (role=alert, WCAG 4.1.3), with or without the deprecated announce prop", () => {
    render(
      <Field label="Code" error="Required.">
        <Input />
      </Field>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Required.");
  });

  it("announces the inline error to assistive tech when announce is set (role=alert)", () => {
    render(
      <Field label="Code" error="Required." announce>
        <Input />
      </Field>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Required.");
  });

  it("keeps a caller-supplied hint association alongside the error (merged aria-describedby)", () => {
    const { rerender } = render(
      <Field label="Code">
        <Input aria-describedby="code-hint" />
      </Field>,
    );
    expect(screen.getByLabelText("Code")).toHaveAttribute("aria-describedby", "code-hint");
    rerender(
      <Field id="code" label="Code" error="Required.">
        <Input aria-describedby="code-hint" />
      </Field>,
    );
    expect(screen.getByLabelText("Code")).toHaveAttribute("aria-describedby", "code-hint code-error");
  });
});
