import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// CLOS2-S2-05: default year follows the IST calendar, not the host clock.
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/roleGuard")>()),
  getSessionRoles: () => ["hr_admin"],
}));
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import HolidaysPage from "./page";

describe("HolidaysPage default year (IST)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => vi.useRealTimers());

  it("01:00 IST on 1 Jan 2027 lists 2027", async () => {
    vi.setSystemTime(new Date("2026-12-31T19:30:00Z"));
    await HolidaysPage({});
    expect(String(fetchJsonMock.mock.calls[0]?.[0])).toContain("2027");
  });

  it("23:30 IST on 31 Dec 2026 still lists 2026", async () => {
    vi.setSystemTime(new Date("2026-12-31T18:00:00Z"));
    await HolidaysPage({});
    expect(String(fetchJsonMock.mock.calls[0]?.[0])).toContain("2026");
  });
});
