import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useInAppNavigationGuard } from "./useInAppNavigationGuard";

function Harness({ active, onBlocked }: { active: boolean; onBlocked: (d: string) => void }) {
  useInAppNavigationGuard(active, onBlocked);
  return (
    <div>
      <a href="/hr/training">internal</a>
      <a href="/hr/training?x=1#frag">internal-with-query</a>
      <a href="#section">hash-only</a>
      <a href="https://example.org/away">external</a>
      <a href="/hr/new-tab" target="_blank" rel="noreferrer">new-tab</a>
      <a href="/hr/file.csv" download>download</a>
      <a href="/hr/inner"><span>nested child</span></a>
    </div>
  );
}

/**
 * Clicks `el` and reports what the guard did with it. A bubble-phase document
 * listener runs only if the guard did NOT stop propagation; it records whether
 * the guard had already cancelled the default, then cancels it itself so jsdom
 * does not try (and noisily fail) to perform a real navigation.
 */
function click(el: Element, init?: MouseEventInit): { reached: boolean; guardCancelled: boolean } {
  const seen = { reached: false, guardCancelled: false };
  const spy = (e: Event) => {
    seen.reached = true;
    seen.guardCancelled = e.defaultPrevented;
    e.preventDefault();
  };
  document.addEventListener("click", spy);
  fireEvent.click(el, init);
  document.removeEventListener("click", spy);
  return seen;
}

describe("useInAppNavigationGuard (GAP-HR-TRAINING-NEW-05)", () => {
  it("blocks a same-origin link click while active and reports the destination", () => {
    const onBlocked = vi.fn();
    render(<Harness active onBlocked={onBlocked} />);
    const seen = click(screen.getByText("internal"));
    expect(seen.reached).toBe(false); // propagation stopped before next/link could navigate
    expect(onBlocked).toHaveBeenCalledWith("/hr/training");
  });

  it("keeps the query string and hash of the destination", () => {
    const onBlocked = vi.fn();
    render(<Harness active onBlocked={onBlocked} />);
    fireEvent.click(screen.getByText("internal-with-query"));
    expect(onBlocked).toHaveBeenCalledWith("/hr/training?x=1#frag");
  });

  it("catches a click on an element nested inside the anchor", () => {
    const onBlocked = vi.fn();
    render(<Harness active onBlocked={onBlocked} />);
    fireEvent.click(screen.getByText("nested child"));
    expect(onBlocked).toHaveBeenCalledWith("/hr/inner");
  });

  it("does nothing while inactive", () => {
    const onBlocked = vi.fn();
    render(<Harness active={false} onBlocked={onBlocked} />);
    const seen = click(screen.getByText("internal"));
    expect(seen).toEqual({ reached: true, guardCancelled: false });
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it("leaves external, hash-only, new-tab, download and modified clicks alone", () => {
    const onBlocked = vi.fn();
    render(<Harness active onBlocked={onBlocked} />);
    for (const label of ["external", "hash-only", "new-tab", "download"]) {
      expect(click(screen.getByText(label))).toEqual({ reached: true, guardCancelled: false });
    }
    expect(click(screen.getByText("internal"), { ctrlKey: true }).guardCancelled).toBe(false);
    expect(click(screen.getByText("internal"), { metaKey: true }).guardCancelled).toBe(false);
    expect(click(screen.getByText("internal"), { button: 1 }).guardCancelled).toBe(false);
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it("stops intercepting once it is deactivated", () => {
    const onBlocked = vi.fn();
    const { rerender } = render(<Harness active onBlocked={onBlocked} />);
    rerender(<Harness active={false} onBlocked={onBlocked} />);
    expect(click(screen.getByText("internal")).reached).toBe(true);
    expect(onBlocked).not.toHaveBeenCalled();
  });
});
