import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { HearingsActions } from "./HearingsActions";

describe("HearingsActions (GAP-LEGAL-HEARINGS-03)", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  it("does not render a 'Calendar view' link to the current page", () => {
    render(<HearingsActions />);
    expect(screen.queryByRole("link", { name: /calendar view/i })).not.toBeInTheDocument();
  });

  it("shows a visible 'Refreshed' message on success (not sr-only only)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    render(<HearingsActions />);
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(screen.getByText(/Hearings refreshed\./)).toBeInTheDocument());
    const msg = screen.getByText(/Hearings refreshed\./);
    expect(msg.className).not.toContain("sr-only");
    expect(refreshMock).toHaveBeenCalled();
  });

  it("shows a visible error message on failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    render(<HearingsActions />);
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/.+/));
  });

  it("no control claims to 'sync' court data", () => {
    render(<HearingsActions />);
    expect(screen.queryByRole("button", { name: /sync/i })).not.toBeInTheDocument();
  });
});
