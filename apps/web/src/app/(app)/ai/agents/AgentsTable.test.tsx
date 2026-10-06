/**
 * GAP-AI-AGENTS-02 / -03 — the dedicated agents table exposes the full id via a
 * copy control (title + clipboard) and formats the "Updated" timestamp instead
 * of printing a raw ISO string.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

import { AgentsTable } from "./AgentsTable";

const ID = "3f2a9c1e-1111-4000-8000-000000000001"; // gitleaks:allow

describe("AgentsTable (GAP-AI-AGENTS-02/03)", () => {
  it("formats the Updated timestamp (not a raw ISO string)", () => {
    render(<AgentsTable agents={[{ id: ID, name: "Triage bot", status: "active", updatedAt: "2026-09-24T09:12:40.000Z" }]} />);
    expect(screen.queryByText("2026-09-24T09:12:40.000Z")).not.toBeInTheDocument();
    // formatIndianDateTime renders "dd Mon yyyy, hh:mm am/pm" in IST.
    expect(screen.getByText(/24 Sep 2026/)).toBeInTheDocument();
  });

  it("exposes the full id via the copy control's title and copies it on click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<AgentsTable agents={[{ id: ID, name: "Triage bot", status: "active", updatedAt: null }]} />);

    const copy = screen.getByRole("button", { name: `Copy agent id ${ID}` });
    expect(copy).toHaveAttribute("title", ID);
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ID));
  });

  it("shows '—' for a missing updated timestamp, not an empty cell", () => {
    render(<AgentsTable agents={[{ id: ID, name: "Triage bot", status: "active", updatedAt: null }]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
