import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BreakglassTable } from "./BreakglassTable";

const rows = [
  {
    id: "bg-ended",
    actor: "A. Officer",
    actorEmail: "a@example.com",
    reason: "x",
    startedAt: "2026-01-01T10:00:00Z",
    endedAt: "2026-01-01T12:15:00Z",
    status: "ended" as const,
  },
  {
    id: "bg-exp",
    actor: "B. Officer",
    actorEmail: "b@example.com",
    reason: "y",
    startedAt: "2026-01-01T10:00:00Z",
    endedAt: undefined,
    status: "auto_expired" as const,
  },
];

describe("BreakglassTable — OTHER (03) + DEADROUTE (04)", () => {
  it("shows elapsed duration '2h 15m' for an ended row, not just 'Ended'", () => {
    render(<BreakglassTable events={rows} />);
    expect(screen.getByText("2h 15m")).toBeTruthy();
  });

  it("labels an auto_expired row as auto-expired, never 'Ongoing'", () => {
    render(<BreakglassTable events={rows} />);
    expect(screen.getByText(/Auto-expired/)).toBeTruthy();
    expect(screen.queryByText("Ongoing")).toBeNull();
  });

  it("links the requester name to the detail route", () => {
    render(<BreakglassTable events={rows} />);
    const link = screen.getByRole("link", { name: "A. Officer" });
    expect(link.getAttribute("href")).toBe("/tenant-admin/breakglass/bg-ended");
  });
});
