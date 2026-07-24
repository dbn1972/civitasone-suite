import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSSEConnection, computeBackoff } from "./useSSEConnection";

// Mock EventSource
class MockEventSource {
  url: string;
  withCredentials: boolean;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;
  private listeners: Record<string, Array<(event: unknown) => void>> = {};

  constructor(url: string, opts?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = opts?.withCredentials ?? false;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }

  removeEventListener(type: string, handler: (event: unknown) => void) {
    if (this.listeners[type]) {
      this.listeners[type] = this.listeners[type].filter((h) => h !== handler);
    }
  }

  close() {
    this.readyState = 2;
  }

  // Test helpers
  simulateOpen() {
    this.readyState = 1;
    this.onopen?.();
  }

  simulateError() {
    this.onerror?.();
  }

  simulateEvent(type: string, data: string) {
    const event = { data, type, lastEventId: "" };
    this.listeners[type]?.forEach((h) => h(event));
  }

  static instances: MockEventSource[] = [];
  static reset() {
    MockEventSource.instances = [];
  }
}

describe("computeBackoff", () => {
  it("returns initial delay for attempt 0", () => {
    expect(computeBackoff(0, 1000, 30000)).toBe(1000);
  });

  it("doubles the delay each attempt", () => {
    expect(computeBackoff(1, 1000, 30000)).toBe(2000);
    expect(computeBackoff(2, 1000, 30000)).toBe(4000);
    expect(computeBackoff(3, 1000, 30000)).toBe(8000);
    expect(computeBackoff(4, 1000, 30000)).toBe(16000);
  });

  it("caps at max backoff", () => {
    expect(computeBackoff(5, 1000, 30000)).toBe(30000);
    expect(computeBackoff(6, 1000, 30000)).toBe(30000);
    expect(computeBackoff(10, 1000, 30000)).toBe(30000);
  });

  it("respects custom initial and max values", () => {
    expect(computeBackoff(0, 500, 10000)).toBe(500);
    expect(computeBackoff(1, 500, 10000)).toBe(1000);
    expect(computeBackoff(5, 500, 10000)).toBe(10000);
  });
});

describe("useSSEConnection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.reset();
    (globalThis as unknown as { EventSource: typeof MockEventSource }).EventSource = MockEventSource;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("connects to the provided URL on mount", () => {
    renderHook(() => useSSEConnection({ url: "/test/stream", enabled: true }));
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe("/test/stream");
  });

  it("does not connect when disabled", () => {
    renderHook(() => useSSEConnection({ url: "/test/stream", enabled: false }));
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it("reports connected state on successful open", () => {
    const onStateChange = vi.fn();
    renderHook(() =>
      useSSEConnection({ url: "/test/stream", enabled: true, onStateChange }),
    );
    act(() => {
      MockEventSource.instances[0].simulateOpen();
    });
    expect(onStateChange).toHaveBeenCalledWith("connected");
  });

  it("reports disconnected state on error", () => {
    const onStateChange = vi.fn();
    renderHook(() =>
      useSSEConnection({ url: "/test/stream", enabled: true, onStateChange }),
    );
    act(() => {
      MockEventSource.instances[0].simulateOpen();
    });
    act(() => {
      MockEventSource.instances[0].simulateError();
    });
    expect(onStateChange).toHaveBeenCalledWith("disconnected");
  });

  it("reconnects with exponential backoff after error", () => {
    renderHook(() =>
      useSSEConnection({ url: "/test/stream", enabled: true, initialBackoff: 1000, maxBackoff: 30000 }),
    );

    // Initial connection
    expect(MockEventSource.instances).toHaveLength(1);

    act(() => {
      MockEventSource.instances[0].simulateOpen();
    });

    // Simulate first error
    act(() => {
      MockEventSource.instances[0].simulateError();
    });

    // After 1s (first backoff), should reconnect
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(MockEventSource.instances).toHaveLength(2);

    // Simulate second error
    act(() => {
      MockEventSource.instances[1].simulateError();
    });

    // After 2s (second backoff), should reconnect
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(MockEventSource.instances).toHaveLength(2); // Not yet
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(MockEventSource.instances).toHaveLength(3);

    // Simulate third error
    act(() => {
      MockEventSource.instances[2].simulateError();
    });

    // After 4s (third backoff), should reconnect
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(MockEventSource.instances).toHaveLength(4);
  });

  it("resets backoff attempt counter on successful reconnection", () => {
    renderHook(() =>
      useSSEConnection({ url: "/test/stream", enabled: true, initialBackoff: 1000, maxBackoff: 30000 }),
    );

    // Fail first connection
    act(() => { MockEventSource.instances[0].simulateError(); });

    // Wait 1s for first reconnect
    act(() => { vi.advanceTimersByTime(1000); });
    expect(MockEventSource.instances).toHaveLength(2);

    // Successful connection — resets backoff
    act(() => { MockEventSource.instances[1].simulateOpen(); });

    // Fail again — should use 1s backoff (reset), not 2s
    act(() => { MockEventSource.instances[1].simulateError(); });

    act(() => { vi.advanceTimersByTime(1000); });
    expect(MockEventSource.instances).toHaveLength(3);
  });

  it("caps backoff at maxBackoff", () => {
    renderHook(() =>
      useSSEConnection({ url: "/test/stream", enabled: true, initialBackoff: 1000, maxBackoff: 30000 }),
    );

    // Simulate many failures to exceed 30s
    for (let i = 0; i < 6; i++) {
      const instance = MockEventSource.instances[MockEventSource.instances.length - 1];
      act(() => { instance.simulateError(); });
      const delay = Math.min(1000 * Math.pow(2, i), 30000);
      act(() => { vi.advanceTimersByTime(delay); });
    }

    // After 5 failures, the 6th backoff should cap at 30s (not 32s)
    const lastInstance = MockEventSource.instances[MockEventSource.instances.length - 1];
    act(() => { lastInstance.simulateError(); });
    act(() => { vi.advanceTimersByTime(29999); });
    const countBefore = MockEventSource.instances.length;
    act(() => { vi.advanceTimersByTime(1); });
    expect(MockEventSource.instances.length).toBe(countBefore + 1);
  });

  it("calls onEvent when a notification event is received", () => {
    const onEvent = vi.fn();
    renderHook(() =>
      useSSEConnection({ url: "/test/stream", enabled: true, onEvent }),
    );

    act(() => { MockEventSource.instances[0].simulateOpen(); });
    act(() => {
      MockEventSource.instances[0].simulateEvent("notification", JSON.stringify({ id: "n1", title: "Test" }));
    });

    expect(onEvent).toHaveBeenCalledWith("notification", { id: "n1", title: "Test" });
  });

  it("closes connection on unmount", () => {
    const { unmount } = renderHook(() =>
      useSSEConnection({ url: "/test/stream", enabled: true }),
    );
    const instance = MockEventSource.instances[0];
    unmount();
    expect(instance.readyState).toBe(2); // closed
  });
});
