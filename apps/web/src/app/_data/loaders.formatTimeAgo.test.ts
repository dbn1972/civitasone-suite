import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/headers", () => ({ cookies: () => ({ get: vi.fn() }) }));

import { formatTimeAgo } from "./loaders";

const NOW = new Date("2026-10-22T10:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("loaders formatTimeAgo (CLOS2-S3-09)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns a dash for unparsable or empty input, never NaN", () => {
    expect(formatTimeAgo("garbage")).toBe("—");
    expect(formatTimeAgo("")).toBe("—");
    expect(formatTimeAgo(undefined as unknown as string)).toBe("—");
  });

  it("clamps a slightly-future timestamp to Just now, never a negative age", () => {
    expect(formatTimeAgo(new Date(NOW.getTime() + 5 * MIN).toISOString())).toBe("Just now");
  });

  it("keeps the existing output for valid past timestamps", () => {
    expect(formatTimeAgo(ago(5 * MIN))).toBe("5m ago");
    expect(formatTimeAgo(ago(3 * HOUR))).toBe("3h ago");
    expect(formatTimeAgo(ago(2 * DAY))).toBe("2d ago");
    expect(formatTimeAgo(ago(14 * DAY))).toBe("14d ago");
  });
});
