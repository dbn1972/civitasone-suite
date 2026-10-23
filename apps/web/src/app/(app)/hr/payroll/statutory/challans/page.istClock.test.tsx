import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// CLOS2-S2-03: default period follows the IST calendar, not the host clock.
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/roleGuard")>()),
  getSessionRoles: () => ["payroll_admin"],
}));
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import ChallansPage from "./page";

describe("ChallansPage default period (IST)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => vi.useRealTimers());

  it("01:00 IST on 1 Apr 2026 defaults to 2026-04", async () => {
    vi.setSystemTime(new Date("2026-03-31T19:30:00Z"));
    await ChallansPage({ searchParams: Promise.resolve({}) });
    expect(String(fetchJsonMock.mock.calls[0]?.[0])).toContain("period=2026-04");
  });

  it("23:30 IST on 31 Mar 2026 still defaults to 2026-03", async () => {
    vi.setSystemTime(new Date("2026-03-31T18:00:00Z"));
    await ChallansPage({ searchParams: Promise.resolve({}) });
    expect(String(fetchJsonMock.mock.calls[0]?.[0])).toContain("period=2026-03");
  });
});
