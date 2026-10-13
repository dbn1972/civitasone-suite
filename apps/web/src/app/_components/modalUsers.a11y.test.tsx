import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { ApproveApplicationDialog } from "../(app)/grants/applications/[id]/ApproveApplicationDialog";
import { ScoreApplicationDialog } from "../(app)/grants/applications/[id]/ScoreApplicationDialog";
import { CloseOpportunityDialog } from "./crm/CloseOpportunityDialog";
import { ShortcutSheet } from "./ShortcutSheet";
import { FirstRunTour } from "../(app)/dashboard/FirstRunTour";

/**
 * W1 SF-19 a11y contract for components ported from hand-rolled overlays onto
 * ds/Modal: on open focus moves inside the dialog, Tab / Shift+Tab wrap at the
 * edges (focus trap), the rest of the page is `inert`, and Escape closes it and
 * returns focus to the control that opened it.
 */

const FOCUSABLE = "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])";

// jsdom has no layout, so `offsetParent` (Modal's visibility check for the Tab
// trap) is always null; report "attached and visible" like a real browser would.
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
  if (offsetParentDescriptor) Object.defineProperty(HTMLElement.prototype, "offsetParent", offsetParentDescriptor);
});

function Host({ children }: { children: (open: boolean, close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open it
      </button>
      {children(open, () => setOpen(false))}
    </>
  );
}

function openFromTrigger(): HTMLElement {
  const trigger = screen.getByRole("button", { name: "Open it" });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
}

function assertDialogContract(role: "dialog" | "alertdialog", trigger: HTMLElement) {
  const dialog = screen.getByRole(role);
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(dialog).toHaveAttribute("aria-labelledby");

  // Focus moved inside, and the background is inert.
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(trigger.closest("[inert]")).not.toBeNull();

  // Tab from the last focusable wraps to the first; Shift+Tab from the first wraps to the last.
  const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
  expect(focusables.length).toBeGreaterThan(1);
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  last.focus();
  fireEvent.keyDown(document.activeElement ?? last, { key: "Tab" });
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(document.activeElement ?? first, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(last);
}

describe("SF-19 ported Modal users: focus trap, inert background, Escape, focus restore", () => {
  it("ApproveApplicationDialog", () => {
    const onCancel = vi.fn();
    render(
      <Host>
        {(open, close) => (
          <ApproveApplicationDialog open={open} onCancel={() => { onCancel(); close(); }} onSubmit={vi.fn()} />
        )}
      </Host>,
    );
    const trigger = openFromTrigger();
    assertDialogContract("alertdialog", trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.closest("[inert]")).toBeNull();
  });

  it("ApproveApplicationDialog ignores Escape while a request is in flight", () => {
    const onCancel = vi.fn();
    render(<ApproveApplicationDialog open busy onCancel={onCancel} onSubmit={vi.fn()} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("ScoreApplicationDialog", () => {
    render(
      <Host>
        {(open, close) => <ScoreApplicationDialog open={open} onCancel={close} onSubmit={vi.fn()} />}
      </Host>,
    );
    const trigger = openFromTrigger();
    assertDialogContract("alertdialog", trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("CloseOpportunityDialog", () => {
    render(
      <Host>
        {(open, close) => (
          <CloseOpportunityDialog opportunityId="o1" opportunityName="Road repair" open={open} onClose={close} />
        )}
      </Host>,
    );
    const trigger = openFromTrigger();
    assertDialogContract("alertdialog", trigger);
    expect(within(screen.getByRole("alertdialog")).getByText(/Road repair/)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("ShortcutSheet", () => {
    render(
      <Host>
        {(open, close) => (
          <ShortcutSheet
            open={open}
            onClose={close}
            shortcuts={[{ keys: "g d", label: "Go to dashboard", category: "Navigation", action: () => {} } as never]}
          />
        )}
      </Host>,
    );
    const trigger = openFromTrigger();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("Keyboard Shortcuts");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(trigger.closest("[inert]")).not.toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("FirstRunTour traps Tab, makes the page inert and Escape restores focus", () => {
    localStorage.clear();
    const trigger = document.createElement("button");
    trigger.textContent = "Page control";
    document.body.appendChild(trigger);
    trigger.focus();
    try {
      render(<FirstRunTour />);
      const dialog = screen.getByRole("dialog");
      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(trigger.hasAttribute("inert")).toBe(true);

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "Next" }));
      });
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      focusables[focusables.length - 1].focus();
      fireEvent.keyDown(document.activeElement ?? dialog, { key: "Tab" });
      expect(document.activeElement).toBe(focusables[0]);

      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger.hasAttribute("inert")).toBe(false);
      expect(document.activeElement).toBe(trigger);
    } finally {
      trigger.remove();
    }
  });
});
