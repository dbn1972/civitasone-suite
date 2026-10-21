import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));

import { useUnsavedNavigationGuard } from "./useUnsavedNavigationGuard";

function Harness({ dirty }: { dirty: boolean }) {
  const guard = useUnsavedNavigationGuard(dirty);
  return (
    <div>
      <a href="/crm/accounts">Accounts</a>
      <a href="/crm/accounts?tab=notes#top">Accounts with query</a>
      <a href="/#section">Same page hash</a>
      <a href="https://example.gov.in/x">External</a>
      <a href="mailto:ops@example.gov.in">Mail</a>
      <a href="/crm/accounts" target="_blank" rel="noreferrer">New tab</a>
      <a href="/files/report.pdf" download>Download</a>
      <p data-testid="pending">{guard.pendingHref ?? "none"}</p>
      <button onClick={guard.stay}>stay</button>
      <button onClick={guard.leave}>leave</button>
    </div>
  );
}

/** Click an element the guard must ignore. */
function click(el: Element, init: MouseEventInit = {}): void {
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  act(() => { el.dispatchEvent(ev); });
}

// jsdom tries a real navigation for any anchor click nobody cancelled -- including the links the guard
// (rightly) ignores. Cancel those in the BUBBLE phase on the document. A click the guard captures never
// gets here (it stops propagation first), so a cancelled default on a captured click is the guard's doing.
const cancelNavigation = (e: Event) => e.preventDefault();

beforeEach(() => {
  push.mockReset();
  document.addEventListener("click", cancelNavigation);
});
afterEach(() => {
  document.removeEventListener("click", cancelNavigation);
});

describe("useUnsavedNavigationGuard (GAP-CRM-DEDUP-RULES-02)", () => {
  it("is inert while the form is clean", () => {
    render(<Harness dirty={false} />);
    fireEvent.click(screen.getByText("Accounts"));
    expect(screen.getByTestId("pending")).toHaveTextContent("none");
  });

  it("captures a same-origin link click while dirty: cancels it and records the destination", () => {
    render(<Harness dirty />);
    const link = screen.getByText("Accounts");
    const reachedLink = vi.fn();
    link.addEventListener("click", reachedLink);
    // fireEvent returns false when the click's default action was cancelled.
    expect(fireEvent.click(link)).toBe(false);
    expect(reachedLink).not.toHaveBeenCalled();
    expect(screen.getByTestId("pending")).toHaveTextContent("/crm/accounts");
  });

  it("keeps the query string and hash of the destination", () => {
    render(<Harness dirty />);
    fireEvent.click(screen.getByText("Accounts with query"));
    expect(screen.getByTestId("pending")).toHaveTextContent("/crm/accounts?tab=notes#top");
  });

  it.each([
    ["a same-page #hash link", "Same page hash", {}],
    ["an external link", "External", {}],
    ["a mailto: link", "Mail", {}],
    ["a target=_blank link", "New tab", {}],
    ["a download link", "Download", {}],
    ["a ctrl-click (open in new tab)", "Accounts", { ctrlKey: true }],
    ["a meta-click", "Accounts", { metaKey: true }],
    ["a shift-click", "Accounts", { shiftKey: true }],
    ["a middle-click", "Accounts", { button: 1 }],
  ])("does not intercept %s", (_name, label, init) => {
    render(<Harness dirty />);
    click(screen.getByText(label as string), init as MouseEventInit);
    expect(screen.getByTestId("pending")).toHaveTextContent("none");
  });

  it("stay() clears the pending destination without navigating", () => {
    render(<Harness dirty />);
    fireEvent.click(screen.getByText("Accounts"));
    fireEvent.click(screen.getByText("stay"));
    expect(screen.getByTestId("pending")).toHaveTextContent("none");
    expect(push).not.toHaveBeenCalled();
  });

  it("leave() pushes the pending destination through the router", () => {
    render(<Harness dirty />);
    fireEvent.click(screen.getByText("Accounts"));
    fireEvent.click(screen.getByText("leave"));
    expect(push).toHaveBeenCalledWith("/crm/accounts");
    expect(screen.getByTestId("pending")).toHaveTextContent("none");
  });

  it("leave() with nothing pending does not navigate", () => {
    render(<Harness dirty />);
    fireEvent.click(screen.getByText("leave"));
    expect(push).not.toHaveBeenCalled();
  });

  it("stops intercepting once the form becomes clean again", () => {
    const { rerender } = render(<Harness dirty />);
    rerender(<Harness dirty={false} />);
    fireEvent.click(screen.getByText("Accounts"));
    expect(screen.getByTestId("pending")).toHaveTextContent("none");
  });

  it("also arms the browser beforeunload prompt while dirty", () => {
    render(<Harness dirty />);
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});
