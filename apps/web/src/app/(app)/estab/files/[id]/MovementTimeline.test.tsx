import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { MovementTimeline, type FileMovement } from "./MovementTimeline";

const MOVEMENTS: FileMovement[] = [
  {
    id: "m-1",
    fromOfficerId: "off-1",
    toOfficerId: "off-2",
    action: "forward",
    movedAt: "2026-08-10T09:00:00Z",
    status: "pending",
    remarks: "For comments",
  },
  {
    id: "m-2",
    fromOfficerId: "off-2",
    toOfficerId: "off-3",
    action: "returned",
    movedAt: "2026-08-15T09:00:00Z",
    status: "active",
    remarks: null,
  },
];

describe("MovementTimeline (Req 4.3)", () => {
  beforeEach(() => {
    // OfficerName fetches a roster/directory — stub fetch so it degrades to short-id labels.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders every movement as a timeline entry, newest first", () => {
    render(<MovementTimeline movements={MOVEMENTS} />);

    const list = screen.getByRole("list", { name: "File movement trail" });
    const items = list.querySelectorAll("li");
    expect(items).toHaveLength(2);
    // Newest (m-2, movedAt 08/15) should render before m-1 (08/10).
    expect(items[0].textContent).toContain("Returned");
    expect(items[1].textContent).toContain("Forwarded");
  });

  it("shows the action verb, status badge and remarks for each entry", () => {
    render(<MovementTimeline movements={MOVEMENTS} />);

    expect(screen.getByText("Forwarded")).toBeInTheDocument();
    expect(screen.getByText("Returned")).toBeInTheDocument();
    expect(screen.getByText(/For comments/)).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("renders an empty ordered list when there are no movements", () => {
    render(<MovementTimeline movements={[]} />);

    const list = screen.getByRole("list", { name: "File movement trail" });
    expect(list.querySelectorAll("li")).toHaveLength(0);
  });
});
