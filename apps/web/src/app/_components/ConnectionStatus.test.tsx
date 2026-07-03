import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ConnectionStatus } from "./ConnectionStatus";

describe("ConnectionStatus", () => {
  beforeEach(() => {
    // Default to online
    Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });
  });

  it("renders nothing when online", () => {
    const { container } = render(<ConnectionStatus />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows offline badge when navigator.onLine is false", () => {
    Object.defineProperty(navigator, "onLine", { value: false, writable: true, configurable: true });
    render(<ConnectionStatus />);
    expect(screen.getByRole("status")).toHaveTextContent(/Offline/);
  });

  it("shows syncing state on online event then transitions back", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, writable: true, configurable: true });
    vi.useFakeTimers();
    render(<ConnectionStatus />);
    expect(screen.getByRole("status")).toHaveTextContent(/Offline/);

    // Come back online
    Object.defineProperty(navigator, "onLine", { value: true, writable: true, configurable: true });
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.getByRole("status")).toHaveTextContent(/Syncing/);

    // After timeout, goes back to online (renders nothing)
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("shows offline badge on offline event", () => {
    render(<ConnectionStatus />);
    Object.defineProperty(navigator, "onLine", { value: false, writable: true, configurable: true });
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByRole("status")).toHaveTextContent(/Offline/);
  });
});
