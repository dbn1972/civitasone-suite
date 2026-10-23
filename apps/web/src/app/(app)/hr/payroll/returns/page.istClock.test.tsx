import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// CLOS2-S2-01: the default FY/quarter must follow the IST calendar, not the
// (UTC) host clock.
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/roleGuard")>()),
  getSessionRoles: () => ["payroll_admin"],
}));
const statusAwareGetMock = vi.fn();
vi.mock("../_lib/statusAwareFetch", () => ({
  statusAwareGet: (...args: unknown[]) => statusAwareGetMock(...args),
}));
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }),
}));

import ReturnsPage from "./page";

describe("ReturnsPage default FY/quarter (IST)", () => {
  beforeEach(() => {
    statusAwareGetMock.mockReset();
    fetchJsonMock.mockReset();
    statusAwareGetMock.mockResolvedValue({ kind: "http_error", status: 403, body: {} });
    fetchJsonMock.mockResolvedValue({ data: null, source: "api" });
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => vi.useRealTimers());

  const firstUrl = () => String(fetchJsonMock.mock.calls[0]?.[0]);

  it("01:00 IST on 1 Apr is FY 2026-27 Q1 (host clock still on 31 Mar)", async () => {
    vi.setSystemTime(new Date("2026-03-31T19:00:00Z"));
    await ReturnsPage({ searchParams: Promise.resolve({}) });
    expect(firstUrl()).toContain("2026-27");
    expect(firstUrl()).toContain("Q1");
  });

  it("23:30 IST on 31 Mar is still FY 2025-26 Q4", async () => {
    vi.setSystemTime(new Date("2026-03-31T18:00:00Z"));
    await ReturnsPage({ searchParams: Promise.resolve({}) });
    expect(firstUrl()).toContain("2025-26");
    expect(firstUrl()).toContain("Q4");
  });
});
