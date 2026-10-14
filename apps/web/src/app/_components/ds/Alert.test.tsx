import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Alert } from "./Alert";

describe("Alert", () => {
  it("danger is an alert region; every other variant is a status region", () => {
    const { rerender } = render(<Alert variant="danger">Boom</Alert>);
    expect(screen.getByRole("alert")).toHaveTextContent("Boom");
    for (const v of ["info", "success", "warning", "neutral"] as const) {
      rerender(<Alert variant={v}>Note</Alert>);
      expect(screen.getByRole("status")).toHaveAttribute("data-variant", v);
      expect(screen.queryByRole("alert")).toBeNull();
    }
  });

  it("defaults to info", () => {
    render(<Alert>Hello</Alert>);
    expect(screen.getByRole("status")).toHaveAttribute("data-variant", "info");
  });

  it("allows the role to be overridden to keep an existing contract", () => {
    render(<Alert variant="warning" role="alert">Mismatch</Alert>);
    expect(screen.getByRole("alert")).toHaveTextContent("Mismatch");
  });

  it("renders title and action slot", () => {
    render(
      <Alert variant="warning" title="Heads up" action={<button type="button">Retry</button>}>
        Body text
      </Alert>,
    );
    expect(screen.getByText("Heads up")).toBeInTheDocument();
    expect(screen.getByText("Body text")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("shows a dismiss button only when onDismiss is given, and calls it", () => {
    const { rerender } = render(<Alert>Plain</Alert>);
    expect(screen.queryByRole("button")).toBeNull();
    const onDismiss = vi.fn();
    rerender(<Alert onDismiss={onDismiss} dismissLabel="Close notice">Plain</Alert>);
    fireEvent.click(screen.getByRole("button", { name: "Close notice" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("uses theme tokens only, so dark mode follows the .dark token set", () => {
    render(<Alert variant="danger">x</Alert>);
    const el = screen.getByRole("alert");
    expect(el.style.background).toBe("var(--badbg)");
    expect(el.getAttribute("style")).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("merges className, style and passthrough attributes", () => {
    render(<Alert className="x" style={{ marginBottom: 0 }} id="a1" aria-live="assertive">y</Alert>);
    const el = screen.getByRole("status");
    expect(el).toHaveClass("x", "banner");
    expect(el.style.marginBottom).toBe("0px");
    expect(el).toHaveAttribute("id", "a1");
    expect(el).toHaveAttribute("aria-live", "assertive");
  });
});
