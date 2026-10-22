import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@/test-utils/intl-render";

const getBreakglassLogMock = vi.fn();
vi.mock("../../../_data/loaders", async () => {
  const actual = await vi.importActual<typeof import("../../../_data/loaders")>("../../../_data/loaders");
  return { ...actual, getBreakglassLog: (...a: unknown[]) => getBreakglassLogMock(...a) };
});

import BreakglassPage from "./page";

const activeEvent = {
  id: "bg-1",
  actor: "A. Officer",
  actorEmail: "a.officer@example.com",
  reason: "Investigating outage",
  startedAt: new Date().toISOString(),
  endedAt: undefined,
  status: "active" as const,
};

describe("BreakglassPage — FABRICATED (01) + FAILMASK (02)", () => {
  beforeEach(() => getBreakglassLogMock.mockReset());

  it("does not claim 'SRE has been alerted' for an active session", async () => {
    getBreakglassLogMock.mockResolvedValue({ data: [activeEvent], source: "api" });
    render(await BreakglassPage());
    expect(screen.getByRole("status").textContent).toMatch(/active break-glass session/i);
    expect(document.body.textContent).not.toMatch(/SRE has been alerted/i);
  });

  it("shows a prominent alert and no fabricated zero when the log fails to load", async () => {
    getBreakglassLogMock.mockResolvedValue({ data: [], source: "error" });
    render(await BreakglassPage());
    const alerts = screen.getAllByRole("alert");
    const banner = alerts.find((el) => el.className.includes("banner"));
    expect(banner?.textContent).toMatch(/Cannot determine active break-glass sessions/i);
    // Active-now stat must read "—", never a reassuring 0.
    expect(screen.getByText("Active Now").closest(".stat")).toHaveTextContent("—");
  });

  it("shows real counts when healthy", async () => {
    getBreakglassLogMock.mockResolvedValue({ data: [activeEvent], source: "api" });
    render(await BreakglassPage());
    expect(screen.getByText("Active Now").closest(".stat")).toHaveTextContent("1");
  });
});

describe("BreakglassPage — This Month uses the IST calendar month (CLOS-S3-02)", () => {
  beforeEach(() => getBreakglassLogMock.mockReset());
  afterEach(() => vi.useRealTimers());

  it("counts a session started 01:00 IST on the 1st (still the previous UTC month) in the current month", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T10:00:00Z"));
    getBreakglassLogMock.mockResolvedValue({
      data: [{ ...activeEvent, status: "ended" as const, startedAt: "2026-11-01T01:00:00+05:30", endedAt: "2026-11-01T02:00:00+05:30" }],
      source: "api",
    });
    render(await BreakglassPage());
    const label = screen.getByText("This Month");
    expect(label.nextElementSibling?.textContent).toBe("1");
  });
});
