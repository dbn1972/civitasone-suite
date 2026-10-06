import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const getMeetingsPageMock = vi.fn();
vi.mock("../_data/loaders", () => ({
  getMeetingsPage: (...args: unknown[]) => getMeetingsPageMock(...args),
}));

const getSessionRolesMock = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>(
    "@/lib/auth/roleGuard",
  );
  return { ...actual, getSessionRoles: () => getSessionRolesMock() };
});

import MeetingsListPage from "./page";

type Row = { id: string; title: string; type: string; status: string; scheduledAt: string | null; quorumEstablished: boolean; meetingNumber: string | null };
const row = (id: string, status: string): Row => ({
  id,
  title: `Meeting ${id}`,
  type: "committee",
  status,
  scheduledAt: null,
  quorumEstablished: false,
  meetingNumber: null,
});

describe("MeetingsListPage", () => {
  beforeEach(() => {
    getMeetingsPageMock.mockReset();
    getSessionRolesMock.mockReset();
    getSessionRolesMock.mockReturnValue(["committee_secretary"]);
  });

  it("GAP-MEETING-MEETINGS-01: ?status=in_progress passes the filter to the loader", async () => {
    getMeetingsPageMock.mockResolvedValue({
      data: { rows: [row("m1", "in_progress")], page: 1, pageSize: 25, total: 1 },
      source: "api",
    });
    render(await MeetingsListPage({ searchParams: { status: "in_progress" } }));
    expect(getMeetingsPageMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: "in_progress", page: 1 }),
    );
  });

  it("GAP-MEETING-MEETINGS-01: page 2 requests the next page (offset) from the loader", async () => {
    getMeetingsPageMock.mockResolvedValue({
      data: { rows: [row("m1", "scheduled")], page: 2, pageSize: 25, total: 60 },
      source: "api",
    });
    render(await MeetingsListPage({ searchParams: { page: "2" } }));
    expect(getMeetingsPageMock).toHaveBeenCalledWith(expect.objectContaining({ page: 2 }));
  });

  it("GAP-MEETING-MEETINGS-01: shows the true total from the API, not the page length", async () => {
    getMeetingsPageMock.mockResolvedValue({
      data: { rows: [row("m1", "scheduled")], page: 1, pageSize: 25, total: 150 },
      source: "api",
    });
    render(await MeetingsListPage({ searchParams: {} }));
    expect(screen.getByText("All meetings (150)")).toBeInTheDocument();
  });

  it("GAP-MEETING-MEETINGS-02: on error the title reads '(—)' and only one error region shows", async () => {
    getMeetingsPageMock.mockResolvedValue({
      data: { rows: [], page: 1, pageSize: 25, total: 0 },
      source: "error",
    });
    render(await MeetingsListPage({ searchParams: {} }));
    expect(screen.getByText("All meetings (—)")).toBeInTheDocument();
    // Exactly one error alert region (no duplicate amber badge + error state).
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("GAP-MEETING-MEETINGS-04: cancelled and archived render distinct status pills", async () => {
    getMeetingsPageMock.mockResolvedValue({
      data: { rows: [row("c1", "cancelled"), row("a1", "archived")], page: 1, pageSize: 25, total: 2 },
      source: "api",
    });
    const { container } = render(await MeetingsListPage({ searchParams: {} }));
    const pills = Array.from(container.querySelectorAll("span.pill"));
    const cancelled = pills.find((p) => p.textContent === "Cancelled");
    const archived = pills.find((p) => p.textContent === "Archived");
    expect(cancelled).toBeTruthy();
    expect(archived).toBeTruthy();
    // Distinct variant classes (cancelled = bad, archived = mut), not both "closed".
    expect(cancelled!.className).not.toEqual(archived!.className);
  });

  it("GAP-MEETING-MEETINGS-05: the actions column header has an accessible name", async () => {
    getMeetingsPageMock.mockResolvedValue({
      data: { rows: [row("m1", "scheduled")], page: 1, pageSize: 25, total: 1 },
      source: "api",
    });
    render(await MeetingsListPage({ searchParams: {} }));
    const headers = screen.getAllByRole("columnheader");
    // No column header is empty (every <th> has text content).
    for (const h of headers) {
      expect(h.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    }
    expect(within(headers[headers.length - 1]).getByText("Actions")).toBeInTheDocument();
  });
});
