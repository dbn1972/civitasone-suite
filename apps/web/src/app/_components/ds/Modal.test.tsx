import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "./Modal";

describe("Modal", () => {
  const baseProps = {
    open: true,
    onClose: vi.fn(),
    title: "Dialog title",
    children: <p>Body content</p>,
  };

  it("renders nothing when open is false", () => {
    const { container } = render(<Modal {...baseProps} open={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders title and children when open", () => {
    render(<Modal {...baseProps} />);
    expect(screen.getByText("Dialog title")).toBeInTheDocument();
    expect(screen.getByText("Body content")).toBeInTheDocument();
  });

  it("defaults to role=dialog", () => {
    render(<Modal {...baseProps} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("uses role=alertdialog when requested", () => {
    render(<Modal {...baseProps} role="alertdialog" />);
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("links the title via aria-labelledby", () => {
    render(<Modal {...baseProps} />);
    const dialog = screen.getByRole("dialog");
    const titleId = dialog.getAttribute("aria-labelledby");
    expect(titleId).toBeTruthy();
    expect(document.getElementById(titleId!)?.textContent).toContain("Dialog title");
  });

  it("wires aria-describedby to describedById when provided", () => {
    render(
      <Modal {...baseProps} describedById="my-desc">
        <p id="my-desc">Extra detail</p>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-describedby", "my-desc");
  });

  it("omits aria-describedby when describedById is not provided", () => {
    render(<Modal {...baseProps} />);
    expect(screen.getByRole("dialog")).not.toHaveAttribute("aria-describedby");
  });

  it("calls onClose on Escape key", () => {
    const onClose = vi.fn();
    render(<Modal {...baseProps} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when the overlay is clicked", () => {
    const onClose = vi.fn();
    render(<Modal {...baseProps} onClose={onClose} overlayClassName="test-overlay" />);
    const overlay = document.body.querySelector(".test-overlay")!;
    fireEvent.mouseDown(overlay);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not call onClose on overlay click when closeOnOverlayClick is false", () => {
    const onClose = vi.fn();
    render(
      <Modal
        {...baseProps}
        onClose={onClose}
        closeOnOverlayClick={false}
        overlayClassName="test-overlay"
      />,
    );
    const overlay = document.body.querySelector(".test-overlay")!;
    fireEvent.mouseDown(overlay);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("does not call onClose when clicking inside the panel", () => {
    const onClose = vi.fn();
    render(<Modal {...baseProps} onClose={onClose} panelClassName="test-panel" />);
    const panel = document.body.querySelector(".test-panel")!;
    fireEvent.mouseDown(panel);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("appends overlayClassName/panelClassName/titleClassName to the base classes", () => {
    render(
      <Modal
        {...baseProps}
        overlayClassName="extra-overlay"
        panelClassName="extra-panel"
        titleClassName="extra-title"
      />,
    );
    expect(document.body.querySelector(".modal-overlay.extra-overlay")).toBeTruthy();
    expect(document.body.querySelector(".modal-panel.extra-panel")).toBeTruthy();
    expect(document.body.querySelector(".modal-title.extra-title")).toBeTruthy();
  });

  it("applies the size modifier class", () => {
    render(<Modal {...baseProps} size="lg" />);
    expect(document.body.querySelector(".modal-panel--lg")).toBeTruthy();
  });

  it("adds no size modifier class for the default (md) size", () => {
    render(<Modal {...baseProps} />);
    expect(document.body.querySelector(".modal-panel--md")).toBeFalsy();
  });

  describe("focus management", () => {
    // jsdom never runs layout, so `offsetParent` -- the visibility check
    // Modal's Tab-trap uses to skip hidden focusables -- is always null
    // here, which would collapse every test's focusable set down to
    // whichever single element already has focus. Stub it to reflect "in
    // the document and not display:none" for plain always-visible buttons,
    // same as a real browser would report for the elements these tests use.
    let offsetParentDescriptor: PropertyDescriptor | undefined;

    beforeEach(() => {
      offsetParentDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetParent");
      Object.defineProperty(HTMLElement.prototype, "offsetParent", {
        configurable: true,
        get() {
          return this.parentNode;
        },
      });
    });

    afterEach(() => {
      if (offsetParentDescriptor) {
        Object.defineProperty(HTMLElement.prototype, "offsetParent", offsetParentDescriptor);
      }
    });

    it("moves focus into the panel on open", () => {
      render(
        <Modal {...baseProps}>
          <button>First</button>
          <button>Second</button>
        </Modal>,
      );
      expect(screen.getByText("First")).toHaveFocus();
    });

    it("restores focus to the previously focused element on close", () => {
      const trigger = document.createElement("button");
      trigger.textContent = "Open trigger";
      document.body.appendChild(trigger);
      trigger.focus();

      try {
        const { rerender } = render(
          <Modal {...baseProps} open={false}>
            <button>Inside</button>
          </Modal>,
        );
        expect(trigger).toHaveFocus();

        rerender(
          <Modal {...baseProps} open>
            <button>Inside</button>
          </Modal>,
        );
        expect(screen.getByText("Inside")).toHaveFocus();
        expect(trigger).not.toHaveFocus();

        rerender(
          <Modal {...baseProps} open={false}>
            <button>Inside</button>
          </Modal>,
        );
        expect(trigger).toHaveFocus();
      } finally {
        document.body.removeChild(trigger);
      }
    });

    it("traps Tab from the last focusable back to the first", () => {
      render(
        <Modal {...baseProps}>
          <button>First</button>
          <button>Last</button>
        </Modal>,
      );
      screen.getByText("Last").focus();
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" });
      expect(screen.getByText("First")).toHaveFocus();
    });

    it("traps Shift+Tab from the first focusable back to the last", () => {
      render(
        <Modal {...baseProps}>
          <button>First</button>
          <button>Last</button>
        </Modal>,
      );
      screen.getByText("First").focus();
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab", shiftKey: true });
      expect(screen.getByText("Last")).toHaveFocus();
    });
  });

  describe("background inertness while open", () => {
    it("makes document.body's other children inert while open, and restores them on close", () => {
      // Stand-in for "the rest of the app": a body-level sibling with its own
      // focusable control, entirely outside anything RTL's render() attaches.
      const background = document.createElement("div");
      const backgroundButton = document.createElement("button");
      backgroundButton.textContent = "Background action";
      background.appendChild(backgroundButton);
      document.body.appendChild(background);

      try {
        const { rerender } = render(<Modal {...baseProps} open={false} />);
        expect(background.hasAttribute("inert")).toBe(false);

        rerender(<Modal {...baseProps} open />);
        expect(background.hasAttribute("inert")).toBe(true);

        rerender(<Modal {...baseProps} open={false} />);
        expect(background.hasAttribute("inert")).toBe(false);
      } finally {
        document.body.removeChild(background);
      }
    });
  });
});
