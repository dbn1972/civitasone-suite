import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { SSEConnectionStatus } from "./SSEConnectionStatus";

describe("SSEConnectionStatus", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing when connected", () => {
    const { container } = render(<SSEConnectionStatus connectionState="connected" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not show indicator immediately on disconnect (respects showDelay)", () => {
    vi.useFakeTimers();
    const { container } = render(<SSEConnectionStatus connectionState="disconnected" showDelay={3000} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows indicator after showDelay when disconnected", () => {
    vi.useFakeTimers();
    render(<SSEConnectionStatus connectionState="disconnected" showDelay={3000} />);

    act(() => { vi.advanceTimersByTime(3000); });

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/Connection lost/);
  });

  it("shows reconnecting message when reconnecting after delay", () => {
    vi.useFakeTimers();
    render(<SSEConnectionStatus connectionState="reconnecting" showDelay={3000} />);

    act(() => { vi.advanceTimersByTime(3000); });

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/Reconnecting to server/);
  });

  it("hides indicator immediately when connection is restored", () => {
    vi.useFakeTimers();
    const { rerender } = render(<SSEConnectionStatus connectionState="disconnected" showDelay={3000} />);

    // Wait for indicator to appear
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByRole("status")).toBeInTheDocument();

    // Reconnect
    rerender(<SSEConnectionStatus connectionState="connected" showDelay={3000} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not show indicator if reconnected before delay", () => {
    vi.useFakeTimers();
    const { rerender, container } = render(
      <SSEConnectionStatus connectionState="disconnected" showDelay={3000} />,
    );

    // Advance partway through delay
    act(() => { vi.advanceTimersByTime(2000); });
    expect(container).toBeEmptyDOMElement();

    // Reconnect before delay completes
    rerender(<SSEConnectionStatus connectionState="connected" showDelay={3000} />);

    // Advance past original delay time
    act(() => { vi.advanceTimersByTime(2000); });
    expect(container).toBeEmptyDOMElement();
  });

  it("has role=status and aria-live=polite for accessibility", () => {
    vi.useFakeTimers();
    render(<SSEConnectionStatus connectionState="disconnected" showDelay={0} />);

    act(() => { vi.advanceTimersByTime(0); });

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
  });

  it("has data-testid for easier querying", () => {
    vi.useFakeTimers();
    render(<SSEConnectionStatus connectionState="disconnected" showDelay={0} />);

    act(() => { vi.advanceTimersByTime(0); });

    expect(screen.getByTestId("sse-connection-status")).toBeInTheDocument();
  });

  it("uses custom showDelay", () => {
    vi.useFakeTimers();
    const { container } = render(<SSEConnectionStatus connectionState="disconnected" showDelay={5000} />);

    act(() => { vi.advanceTimersByTime(4999); });
    expect(container).toBeEmptyDOMElement();

    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
