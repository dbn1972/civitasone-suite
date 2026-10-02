import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Drawer } from "./Drawer";

// GAP-ADMIN-INTEGRATIONS-06
describe("Drawer", () => {
  // jsdom has no layout, so offsetParent is always null; Modal's trap only counts "visible" focusables.
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetParent", { configurable: true, get() { return (this as HTMLElement).parentNode; } });
  });
  afterAll(() => {
    if (original) Object.defineProperty(HTMLElement.prototype, "offsetParent", original);
  });

  function setup(props: Partial<React.ComponentProps<typeof Drawer>> = {}) {
    const onClose = vi.fn();
    const utils = render(
      <>
        <button>trigger</button>
        <Drawer title="Anthropic" onClose={onClose} footer={<button>Save it</button>} {...props}>
          <input aria-label="first" />
          <input aria-label="second" />
        </Drawer>
      </>,
    );
    return { onClose, ...utils };
  }

  it("is a labelled modal dialog and moves focus inside", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Anthropic" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });

  it("Tab from the last control wraps to the first (focus trap)", () => {
    setup();
    const last = screen.getByRole("button", { name: "Save it" });
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByLabelText("first")).toHaveFocus();
  });

  it("Escape closes", () => {
    const { onClose } = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("busy blocks Escape and overlay-click close", () => {
    const { onClose } = setup({ busy: true });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
  });
});
