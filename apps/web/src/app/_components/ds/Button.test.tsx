import { createRef } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./Button";

describe("Button", () => {
  it("defaults to a primary, default-size button", () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn.className).toBe("btn primary");
    expect(btn).toHaveAttribute("type", "button");
  });

  it("renders the ghost variant", () => {
    render(<Button variant="ghost">Cancel</Button>);
    expect(screen.getByRole("button", { name: "Cancel" }).className).toBe("btn ghost");
  });

  it("renders the danger variant", () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole("button", { name: "Delete" }).className).toBe("btn danger");
  });

  it("renders the secondary variant", () => {
    render(<Button variant="secondary">More</Button>);
    expect(screen.getByRole("button", { name: "More" }).className).toBe("btn secondary");
  });

  it("appends the sm size class", () => {
    render(<Button variant="primary" size="sm">Approve</Button>);
    expect(screen.getByRole("button", { name: "Approve" }).className).toBe("btn primary sm");
  });

  it("merges a caller-supplied className", () => {
    render(<Button className="extra">Go</Button>);
    expect(screen.getByRole("button", { name: "Go" }).className).toBe("btn primary extra");
  });

  it("is disabled and not clickable when disabled is set", () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("disables and marks aria-busy when loading", () => {
    render(<Button loading>Saving…</Button>);
    const btn = screen.getByRole("button", { name: "Saving…" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
  });

  it("does not set aria-busy when not loading", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).not.toHaveAttribute("aria-busy");
  });

  it("passes through a caller-supplied aria-busy independently of loading", () => {
    // A real tranche 3 conversion (WFHRequestForm) drives `disabled` and
    // `aria-busy` from two different conditions, so it cannot use `loading`
    // for both. Before this fix, any explicit aria-busy was silently
    // discarded because the internal aria-busy computation was spread
    // after ...rest and always won -- including collapsing an explicit
    // `false` into a missing attribute.
    const { rerender } = render(<Button aria-busy={false}>Submit</Button>);
    expect(screen.getByRole("button", { name: "Submit" })).toHaveAttribute("aria-busy", "false");

    rerender(<Button aria-busy={true}>Submit</Button>);
    expect(screen.getByRole("button", { name: "Submit" })).toHaveAttribute("aria-busy", "true");
  });

  it("lets loading win over an explicit aria-busy when both are set", () => {
    render(<Button loading aria-busy={false}>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("aria-busy", "true");
  });

  it("allows overriding type to submit", () => {
    render(<Button type="submit">Submit</Button>);
    expect(screen.getByRole("button", { name: "Submit" })).toHaveAttribute("type", "submit");
  });

  it("forwards native button props such as onClick and aria-expanded", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick} aria-expanded={true}>Toggle</Button>);
    const btn = screen.getByRole("button", { name: "Toggle" });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(btn).toHaveAttribute("aria-expanded", "true");
  });

  it("forwards ref to the underlying button element", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Close</Button>);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
    expect(ref.current?.textContent).toBe("Close");
    // Proves the ref is live (not just present) -- callers like a dialog's
    // close button rely on imperative .focus() for WCAG 2.4.3 focus-on-open.
    ref.current?.focus();
    expect(ref.current).toHaveFocus();
  });
});
