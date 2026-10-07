import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ChangeRequest } from "../_data/types";

const getChangeRequests = vi.fn();
vi.mock("../_data/loaders", () => ({ getChangeRequests: () => getChangeRequests() }));

import Page from "./page";

function completed(n: number, over: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    id: `id-${n}`, title: `Release ${n}`, type: "normal", risk: "low", affectedServices: [],
    description: "", rollbackPlan: null, status: "completed", requestedBy: "r", approvedBy: null,
    approvedAt: null, rejectedReason: null, windowStart: null, windowEnd: null,
    releaseNotes: `Notes for release ${n}`, pirOutcome: "success", pirNotes: null,
    pirAt: "2026-09-01T18:30:00.000Z", createdAt: "", updatedAt: "", ...over,
  };
}

describe("change/comms page (GAP-CHANGE-COMMS-01/-02/-03/-04)", () => {
  beforeEach(() => getChangeRequests.mockReset());

  it("COMMS-01: makes no delivery claim — no 'Published'/'broadcast' wording in the page copy", async () => {
    getChangeRequests.mockResolvedValue({ data: [completed(1)], source: "api" });
    render(await Page({ searchParams: {} }));
    expect(screen.getByText("Release notes recorded")).toBeInTheDocument();
    expect(screen.queryByText(/Published releases/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/broadcasts published/i)).not.toBeInTheDocument();
  });

  it("COMMS-03: labels the date as 'Reviewed' (pirAt) rather than a bare date", async () => {
    getChangeRequests.mockResolvedValue({ data: [completed(1)], source: "api" });
    render(await Page({ searchParams: {} }));
    expect(screen.getByText(/^Reviewed /)).toBeInTheDocument();
  });

  it("COMMS-02: paginates to 10 cards and shows 'Showing 1–10 of 15' with a Next link", async () => {
    getChangeRequests.mockResolvedValue({
      data: Array.from({ length: 15 }, (_, i) => completed(i + 1)), source: "api",
    });
    render(await Page({ searchParams: {} }));
    expect(screen.getByText(/Showing 1–10 of 15/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Next/ })).toHaveAttribute("href", "/change/comms?page=2");
  });

  it("COMMS-02: a title query narrows the list", async () => {
    getChangeRequests.mockResolvedValue({
      data: [completed(1, { title: "Payments gateway" }), completed(2, { title: "DB migration" })],
      source: "api",
    });
    render(await Page({ searchParams: { q: "gateway" } }));
    expect(screen.getByText("Payments gateway")).toBeInTheDocument();
    expect(screen.queryByText("DB migration")).not.toBeInTheDocument();
    expect(screen.getByText(/Showing 1–1 of 1/)).toBeInTheDocument();
  });

  it("COMMS-04: a release note is clamped behind a native <details> toggle", async () => {
    getChangeRequests.mockResolvedValue({ data: [completed(1)], source: "api" });
    const { container } = render(await Page({ searchParams: {} }));
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.querySelector("summary")?.textContent).toBe("Release notes");
  });
});
