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

describe("EstabInboxPage", () => {
  beforeEach(() => {
    getEstabFilesMock.mockReset();
  });

  it("GAP-ESTAB-INBOX-02: a failed load shows an error state and '—' stats, not 'Nothing on your desk'", async () => {
    getEstabFilesMock.mockResolvedValueOnce({ data: [], source: "error" });

    const ui = await EstabInboxPage();
    render(ui);

    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText("Nothing on your desk")).not.toBeInTheDocument();
    // All four stat cards read "—" rather than a fabricated 0.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });

  it("GAP-ESTAB-INBOX-05: counts in-transit 'pending' files under 'Awaiting receipt'", async () => {
    getEstabFilesMock.mockResolvedValueOnce({
      data: [
        file({ id: "a", status: "active" }),
        file({ id: "p", status: "pending" }),
        file({ id: "x", status: "archived" }),
      ],
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
      data: [file({ id: "mine-1", fileNo: "ADMIN/2026/0007", subject: "My pending file", status: "active" })],
      source: "api",
    });

    const ui = await EstabInboxPage();
    render(ui);

    expect(getEstabFilesMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("My pending file")).toBeInTheDocument();
  });
});
