import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, seed: unknown) => ({ data: seed, provenance: "live", offline: false, cachedAt: null }),
}));

import { SecurityTable } from "./SecurityTable";
import type { SecurityEvent } from "@/app/_data/loaders";

const EVENTS: SecurityEvent[] = [
  { id: "1", timestamp: "2026-01-15T19:00:00.000Z", type: "login_failed", actor: "asha@dept.gov.in", ipAddress: "203.0.113.42", outcome: "failure" },
  { id: "2", timestamp: "2026-01-15T05:00:00.000Z", type: "mfa_challenge", actor: "ravi@dept.gov.in", ipAddress: "198.51.100.7", outcome: "challenged" },
  { id: "3", timestamp: "2026-01-15T06:00:00.000Z", type: "login_success", actor: "meera@dept.gov.in", ipAddress: "192.0.2.1", outcome: "success" },
];

describe("SecurityTable — SECURITY-03/-04/-05", () => {
  afterEach(() => vi.restoreAllMocks());

  it("masks actor emails and IP addresses by default (-04)", () => {
    render(<SecurityTable events={EVENTS} source="api" />);
    expect(screen.queryByText("asha@dept.gov.in")).toBeNull();
    expect(screen.getByText("a***@d***.g**.i*")).toBeInTheDocument();
    expect(screen.queryByText("203.0.113.42")).toBeNull();
    expect(screen.getByText("203.•••.•••.•••")).toBeInTheDocument();
  });

  it("maps a 'challenged' outcome to a neutral/warn pill, not a failure (-03)", () => {
    render(<SecurityTable events={EVENTS} source="api" />);
    const challenged = screen.getByText("Challenged");
    expect(challenged.className).toContain("warn");
    expect(challenged.className).not.toContain("bad");
    expect(screen.getByText("Failure").className).toContain("bad");
  });

  it("shows human event labels instead of raw codes (-05)", () => {
    render(<SecurityTable events={EVENTS} source="api" />);
    expect(screen.getByText("Login failed")).toBeInTheDocument();
    expect(screen.getByText("MFA challenge")).toBeInTheDocument();
    expect(screen.queryByText("login_failed")).toBeNull();
  });

  it("renders timestamps in a fixed Asia/Kolkata zone (no raw toLocaleString) (-05)", () => {
    render(<SecurityTable events={EVENTS} source="api" />);
    expect(screen.getByText(/16 Jan 2026.*IST/)).toBeInTheDocument();
  });
});

describe("SecurityTable — audited export (-04)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // jsdom has no URL.createObjectURL; the successful-export path downloads the CSV.
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
  });

  it("records an audit event before exporting (fail-closed)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
    render(<SecurityTable events={EVENTS} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: /CSV/i }));
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/proxy/v1/admin/security-exports/audit",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("blocks the export when the audit call fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    render(<SecurityTable events={EVENTS} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: /CSV/i }));
    await waitFor(() => expect(screen.getByText(/Couldn't record this export/i)).toBeInTheDocument());
  });
});
