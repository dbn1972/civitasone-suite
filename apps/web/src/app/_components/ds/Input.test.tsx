import { createRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Input } from "./Input";

describe("Input", () => {
  it("works standalone (no ancestor Field), matching the hand-rolled <input> it replaces", () => {
    render(
      <Input
        id="code"
        aria-invalid={true}
        aria-describedby="code-error"
        required
        aria-required="true"
        placeholder="e.g. FIN"
      />,
    );
    const input = screen.getByPlaceholderText("e.g. FIN");
    expect(input).toHaveAttribute("id", "code");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "code-error");
    expect(input).toBeRequired();
  });

  it("forwards value/onChange like a plain controlled input", () => {
    const onChange = vi.fn();
    render(<Input aria-label="Code" value="FIN" onChange={onChange} />);
    const input = screen.getByLabelText("Code") as HTMLInputElement;
    expect(input.value).toBe("FIN");
    fireEvent.change(input, { target: { value: "FINX" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("forwards a ref to the underlying <input> DOM node", () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input ref={ref} aria-label="Code" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it("merges a caller style over the base style, and applies className", () => {
    render(<Input aria-label="Code" className="my-input" style={{ minHeight: 100 }} />);
    const input = screen.getByLabelText("Code");
    expect(input).toHaveClass("my-input");
    // Base formControlStyle sets minHeight: 44 -- the caller's 100 must win.
    expect(input.style.minHeight).toBe("100px");
    // A base-style property the caller didn't override should still be present.
    expect(input.style.borderRadius).toBe("10px");
  });

  it("is not disabled/invalid/required by default", () => {
    render(<Input aria-label="Plain" />);
    const input = screen.getByLabelText("Plain");
    expect(input).not.toBeDisabled();
    expect(input).not.toBeRequired();
    expect(input).not.toHaveAttribute("aria-invalid");
  });
});
