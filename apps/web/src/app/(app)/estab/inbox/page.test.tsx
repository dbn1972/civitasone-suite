import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getEstabFilesMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getEstabDeskFiles: () => getEstabFilesMock(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import EstabInboxPage from "./page";

function file(partial: Record<string, unknown>) {
  return {
    id: "f1",
    fileNo: "ADMIN/2026/0001",
    subject: "Test",
    status: "active",
    classification: "public",
    currentHolder: undefined,
    dueDate: undefined,
    ...partial,
  };
}

// getEstabDeskFiles resolves to { files, notEnrolled } (GAP-ESTAB-INBOX-01).
const desk = (files: unknown[], notEnrolled = false) => ({ files, notEnrolled });

describe("EstabInboxPage", () => {
  beforeEach(() => {
    getEstabFilesMock.mockReset();
  });

  it("GAP-ESTAB-INBOX-02: a failed load shows an error state and '—' stats, not 'Nothing on your desk'", async () => {
    getEstabFilesMock.mockResolvedValueOnce({ data: desk([]), source: "error" });

    const ui = await EstabInboxPage();
    render(ui);

    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("Nothing on your desk")).not.toBeInTheDocument();
    // All four stat cards read "—" rather than a fabricated 0.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });

  it("GAP-ESTAB-INBOX-05: counts in-transit 'pending' files under 'Awaiting receipt'", async () => {
    getEstabFilesMock.mockResolvedValueOnce({
      data: desk([
        file({ id: "a", status: "active" }),
        file({ id: "p", status: "pending" }),
        file({ id: "x", status: "archived" }),
      ]),
      source: "api",
    });

    const ui = await EstabInboxPage();
    render(ui);

    expect(screen.getByText("Awaiting receipt")).toBeInTheDocument();
    expect(screen.queryByText("Total files")).not.toBeInTheDocument();
  });

  it("GAP-ESTAB-INBOX-01: sources rows from the My-Desk loader (not the full register)", async () => {
    // The page must call getEstabDeskFiles (server-side filtered to the actor),
    // never the whole-register getEstabFiles. The mock stands in for the desk
    // loader; verify it is actually invoked and its rows are shown.
    getEstabFilesMock.mockResolvedValueOnce({
      data: desk([file({ id: "mine-1", fileNo: "ADMIN/2026/0007", subject: "My pending file", status: "active" })]),
      source: "api",
    });

    const ui = await EstabInboxPage();
    render(ui);

    expect(getEstabFilesMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("My pending file")).toBeInTheDocument();
  });

  it("GAP-ESTAB-DASHBOARD-01: the overdue tile is labelled 'on my desk' and counts open files past due, never closed ones", async () => {
    getEstabFilesMock.mockResolvedValueOnce({
      data: desk([
        file({ id: "o1", status: "active", dueDate: "2020-01-01" }),
        file({ id: "o2", status: "draft", dueDate: "2020-01-01" }),
        file({ id: "c1", status: "closed", dueDate: "2020-01-01" }),
        file({ id: "a1", status: "archived", dueDate: "2020-01-01" }),
        file({ id: "f1", status: "active", dueDate: "2999-01-01" }),
      ]),
      source: "api",
    });
    render(await EstabInboxPage());
    const tile = screen.getByText("Overdue on my desk").closest("div") as HTMLElement;
    expect(tile.parentElement?.textContent).toContain("2");
    expect(screen.queryByText(/^Overdue$/)).not.toBeInTheDocument();
  });

  it("GAP-ESTAB-INBOX-01: stats and rows come only from the desk subset the service returned", async () => {
    // The service has already excluded files held by others; the page counts exactly what it is given.
    getEstabFilesMock.mockResolvedValueOnce({
      data: desk([
        file({ id: "m1", fileNo: "ADMIN/2026/0001", subject: "Mine A", status: "active" }),
        file({ id: "m2", fileNo: "ADMIN/2026/0002", subject: "Mine B", status: "active" }),
        file({ id: "m3", fileNo: "ADMIN/2026/0003", subject: "Mine C", status: "pending" }),
      ]),
      source: "api",
    });
    render(await EstabInboxPage());
    expect(screen.getByText("Mine A")).toBeInTheDocument();
    expect(screen.getByText("Mine B")).toBeInTheDocument();
    expect(screen.queryByText("Someone else's file")).toBeNull();
    const activeTile = screen.getByText("Active on desk").closest("div") as HTMLElement;
    expect(activeTile.parentElement?.textContent).toContain("2");
    const awaitingTile = screen.getByText("Awaiting receipt").closest("div") as HTMLElement;
    expect(awaitingTile.parentElement?.textContent).toContain("1");
  });

  it("GAP-ESTAB-INBOX-01: a user who is not an enrolled operator gets an explanation, not 'Nothing on your desk'", async () => {
    getEstabFilesMock.mockResolvedValueOnce({ data: desk([], true), source: "api" });
    render(await EstabInboxPage());
    expect(screen.getByText("You are not enrolled as an eOffice operator")).toBeInTheDocument();
    expect(screen.getByText(/Ask your division administrator to enrol you/)).toBeInTheDocument();
    expect(screen.queryByText("Nothing on your desk")).not.toBeInTheDocument();
  });

  it("GAP-ESTAB-INBOX-01: an enrolled operator with an empty desk still sees 'Nothing on your desk'", async () => {
    getEstabFilesMock.mockResolvedValueOnce({ data: desk([], false), source: "api" });
    render(await EstabInboxPage());
    expect(screen.getByText("Nothing on your desk")).toBeInTheDocument();
    expect(screen.queryByText("You are not enrolled as an eOffice operator")).not.toBeInTheDocument();
  });

  it("GAP-ESTAB-INBOX-01: a not-enrolled user who still holds files (opened before enrolment) sees them, not the empty explanation", async () => {
    getEstabFilesMock.mockResolvedValueOnce({
      data: desk([file({ id: "old", subject: "Opened earlier" })], true),
      source: "api",
    });
    render(await EstabInboxPage());
    expect(screen.getByText("Opened earlier")).toBeInTheDocument();
    expect(screen.queryByText("You are not enrolled as an eOffice operator")).not.toBeInTheDocument();
  });
});

describe("EstabInboxPage — 'Active on desk' uses the service status (GAP-ESTAB-DASHBOARD-01)", () => {
  beforeEach(() => {
    getEstabFilesMock.mockReset();
  });

  const tileValue = (label: string) => {
    const tile = Array.from(document.querySelectorAll(".stat")).find((el) => el.querySelector(".lab")?.textContent === label);
    return tile?.querySelector(".val")?.textContent;
  };

  it("counts draft and active files with the officer, but not pending (awaiting receipt) or finished ones", async () => {
    getEstabFilesMock.mockResolvedValueOnce({
      data: desk([
        file({ id: "a", status: "active" }),
        file({ id: "d", status: "draft" }),
        file({ id: "p", status: "pending" }),
        file({ id: "c", status: "closed" }),
        file({ id: "x", status: "archived" }),
      ]),
      source: "api",
    });
    render(await EstabInboxPage());
    expect(tileValue("Active on desk")).toBe("2");
    expect(tileValue("Awaiting receipt")).toBe("1");
  });
});
