import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, data: unknown) => ({ data, provenance: "live", offline: false, cachedAt: null }),
}));

import { SiemTable } from "./SiemTable";

const alerts = [
  { id: "a1", timestamp: "2026-09-29T00:00:00Z", title: "Brute force", severity: "critical" as const, source: "auth_anomaly", status: "detected" },
  { id: "a2", timestamp: "2026-09-29T00:05:00Z", title: "Port scan", severity: "high" as const, source: "network", status: "resolved" },
];

describe("SiemTable (GAP-TENANT-ADMIN-SIEM-02/04/05)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("gives the critical alert extra emphasis vs high (SIEM-02)", () => {
    render(<SiemTable alerts={alerts} source="api" />);
    // Critical pill carries the 🔴 marker; high does not.
    expect(screen.getByText(/🔴\s*Critical/)).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("humanizes status labels (SIEM-05)", () => {
    render(<SiemTable alerts={alerts} source="api" />);
    expect(screen.getByText("Detected")).toBeInTheDocument();
    expect(screen.getByText("Resolved")).toBeInTheDocument();
  });

  it("records an export audit beacon on CSV download (SIEM-04)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
    render(<SiemTable alerts={alerts} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: /CSV/ }));
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/proxy/v1/admin/siem/alerts/export-audit",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
