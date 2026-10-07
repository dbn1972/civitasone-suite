import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import { AutoRefresh } from "./AutoRefresh";

describe("AutoRefresh (GAP-AI-COPILOT-03 / DETAIL-04)", () => {
  beforeEach(() => { vi.useFakeTimers(); refreshMock.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  it("refreshes every interval while active", () => {
    render(<AutoRefresh active intervalMs={5000} maxMs={120000} />);
    expect(refreshMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it("does not refresh when inactive", () => {
    render(<AutoRefresh active={false} intervalMs={5000} />);
    vi.advanceTimersByTime(20000);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("stops after the max cap", () => {
    render(<AutoRefresh active intervalMs={5000} maxMs={12000} />);
    vi.advanceTimersByTime(5000); // 1
    vi.advanceTimersByTime(5000); // 2
    expect(refreshMock).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(5000); // 15s elapsed > 12s cap -> no more refresh
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });
});
