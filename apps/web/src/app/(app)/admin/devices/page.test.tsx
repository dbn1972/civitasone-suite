import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

let mockRoles: string[] = ["it_admin"];
vi.mock("@/lib/auth/roleGuard", () => ({
  requireAnyRole: (allowed: string[]) => {
    if (!allowed.some((r) => mockRoles.includes(r))) throw new Error("REDIRECT");
  },
}));
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import DevicesPage from "./page";

describe("DevicesPage", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); mockRoles = ["it_admin"]; });

  // GAP-ADMIN-DEVICES-01: GET /v1/hrms/devices/admin returns names, codes and last IPs.
  it("redirects an ordinary employee before fetching anything", async () => {
    mockRoles = ["employee"];
    await expect(DevicesPage()).rejects.toThrow("REDIRECT");
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  // GAP-ADMIN-DEVICES-02: an outage must not read as an empty, clean estate.
  it("500 -> retry state with no 'Total Devices 0' tiles", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error", status: 500 });
    render(await DevicesPage());
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText("Total Devices")).not.toBeInTheDocument();
    expect(screen.queryByText("Blocked")).not.toBeInTheDocument();
  });

  it("403 -> Access restricted", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error", status: 403, errorMessage: "requires one of: hr_admin, it_admin, super_admin" });
    render(await DevicesPage());
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
  });

  it("renders real counts when the load succeeds", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "d1", employeeName: "A", deviceName: "Pixel", platform: "android", trustStatus: "trusted", osVersion: "14", appVersion: "1", lastSeen: "", loginCount: 1, flaggedReason: "" }],
      source: "api",
    });
    render(await DevicesPage());
    expect(screen.getByText("Total Devices").parentElement).toHaveTextContent("1");
  });

  // GAP-ADMIN-DEVICES-05: Android + iOS + Web/other must sum to the total.
  it("counts web / other platforms so the platform cards sum to Total Devices", async () => {
    const mk = (id: string, platform: string) => ({ id, employeeName: "A", deviceName: id, platform, trustStatus: "trusted", osVersion: "", appVersion: "", lastSeen: "", loginCount: 1, flaggedReason: "" });
    fetchJsonMock.mockResolvedValue({ data: [mk("a", "android"), mk("b", "ios"), mk("c", "web")], source: "api" });
    render(await DevicesPage());
    expect(screen.getByText("Total Devices").parentElement).toHaveTextContent("3");
    expect(screen.getByText("Web / other").parentElement).toHaveTextContent("1");
  });

  it("no longer promises 'flag or trust' actions it does not offer", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await DevicesPage());
    expect(screen.queryByText(/block, flag, or trust/)).not.toBeInTheDocument();
  });
});
