import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatRelativeTime } from "./NotificationBell";

const NOW = new Date("2026-10-22T10:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("NotificationBell formatRelativeTime (CLOS2-S3-09)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a dash for unparsable or empty input, never NaN", () => {
    expect(formatRelativeTime("garbage")).toBe("—");
    expect(formatRelativeTime("")).toBe("—");
    expect(formatRelativeTime(undefined as unknown as string)).toBe("—");
  });

  it("clamps a slightly-future timestamp to Just now", () => {
    expect(formatRelativeTime(new Date(NOW.getTime() + 5 * MIN).toISOString())).toBe("Just now");
  });

  it("keeps the existing output for valid past timestamps", () => {
    expect(formatRelativeTime(ago(5 * MIN))).toBe("5m ago");
    expect(formatRelativeTime(ago(3 * HOUR))).toBe("3h ago");
    expect(formatRelativeTime(ago(DAY))).toBe("Yesterday");
    expect(formatRelativeTime(ago(2 * DAY))).toBe("2d ago");
    expect(formatRelativeTime(ago(14 * DAY))).toBe("2w ago");
  });
});
