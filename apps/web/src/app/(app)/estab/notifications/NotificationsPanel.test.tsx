import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

import { NotificationsPanel, isSafeInternalPath } from "./NotificationsPanel";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function note(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "n1",
    kind: "overdue",
    severity: "critical",
    title: "File FR-12 overdue",
    detail: "Pending 3 days",
    at: "2025-12-31T20:00:00Z",
    link: "/estab/files/123",
    ...over,
  };
}

describe("NotificationsPanel — truthful states (L3)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a real error with retry (NOT 'All clear') when the fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ message: "boom" }, 500));

    render(<NotificationsPanel />);

    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.queryByText(/All clear/i)).toBeNull();
  });

  it("shows 'All clear' only on a genuine empty success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ data: [] }));

    render(<NotificationsPanel />);

    await screen.findByText(/All clear/i);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("NotificationsPanel — link safety (GAP-ESTAB-NOTIFICATIONS-02)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("isSafeInternalPath accepts in-app absolute paths and rejects everything else", () => {
    expect(isSafeInternalPath("/estab/files/123")).toBe(true);
    expect(isSafeInternalPath("https://evil.example")).toBe(false);
    expect(isSafeInternalPath("//evil.example")).toBe(false);
    expect(isSafeInternalPath("javascript:alert(1)")).toBe(false);
    expect(isSafeInternalPath("")).toBe(false);
  });

  it("renders an anchor for a safe internal link", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [note({ link: "/estab/files/123" })] }));
    render(<NotificationsPanel />);
    const link = await screen.findByRole("link", { name: /File FR-12 overdue/ });
    expect(link.getAttribute("href")).toBe("/estab/files/123");
  });

  it("renders NO anchor for an absolute/external link", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [note({ link: "https://evil.example" })] }));
    render(<NotificationsPanel />);
    await screen.findByText("File FR-12 overdue");
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("NotificationsPanel — date/time + cap (GAP-ESTAB-NOTIFICATIONS-04/05)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("shows the year and time (not just dd Mon) with a machine dateTime attr", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: [note({ at: "2025-12-31T20:00:00Z" })] }));
    const { container } = render(<NotificationsPanel />);
    await screen.findByText("File FR-12 overdue");
    const time = container.querySelector("time");
    expect(time).not.toBeNull();
    // IST rollover: 2025-12-31T20:00Z -> 01 Jan 2026, 01:30 am
    expect(time!.textContent).toMatch(/2026/);
    expect(time!.getAttribute("dateTime")).toBe("2025-12-31T20:00:00Z");
  });

  it("shows a cap notice when the limit of rows is returned", async () => {
    const rows = Array.from({ length: 80 }, (_, i) => note({ id: `n${i}`, link: "/estab/files/" + i }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: rows }));
    render(<NotificationsPanel />);
    await screen.findByRole("note");
    expect(screen.getByRole("note").textContent).toMatch(/latest 80/i);
  });
});

describe("NotificationsPanel — refresh/polling (GAP-ESTAB-NOTIFICATIONS-01)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refetches on the ~60s interval while visible", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ data: [note()] }));

    render(<NotificationsPanel />);

    // initial load
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
