import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));
const seeded = vi.fn();
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: (...a: unknown[]) => seeded(...a) }));

import { GatewaysTable } from "./GatewaysTable";

const ROWS = [
  { type: "SMS", provider: "NIC", messagesPerDay: 1500, successRate: 0.987, lastChecked: "2024-01-15T19:00:00.000Z", status: "active" },
  { type: "Email", provider: "SES", messagesPerDay: 20, successRate: 90, status: "degraded" },
  { type: "Push", provider: "FCM", status: "down" },
  { type: "WhatsApp", provider: "X", status: "standby" },
];
const stat = (l: string) => (screen.getAllByText(l).find((e) => e.classList.contains("lab")) as HTMLElement).parentElement as HTMLElement;

describe("GatewaysTable", () => {
  beforeEach(() => { refreshMock.mockReset(); seeded.mockReset(); });

  // GAP-ADMIN-GATEWAYS-02
  it("cached rows: Total is 4 even though the server prop is empty", () => {
    seeded.mockReturnValue({ data: ROWS, provenance: "cached", offline: false, cachedAt: "2026-10-01T10:00:00.000Z" });
    render(<GatewaysTable gateways={[]} source="error" />);
    expect(stat("Total Gateways")).toHaveTextContent("4");
    expect(stat("Down / failed")).toHaveTextContent("1");
    expect(stat("Standby")).toHaveTextContent("1");
  });

  // GAP-ADMIN-GATEWAYS-03
  it("error with no cache: Retry, no EmptyState, em dashes", () => {
    seeded.mockReturnValue({ data: [], provenance: "error-no-data", offline: false, cachedAt: null });
    render(<GatewaysTable gateways={[]} source="error" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/No communication gateways/)).not.toBeInTheDocument();
    expect(stat("Total Gateways")).toHaveTextContent("—");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("legitimately empty: EmptyState and zeros", () => {
    seeded.mockReturnValue({ data: [], provenance: "live", offline: false, cachedAt: null });
    render(<GatewaysTable gateways={[]} source="api" />);
    expect(screen.getByText("No communication gateways configured.")).toBeInTheDocument();
    expect(stat("Total Gateways")).toHaveTextContent("0");
  });

  // GAP-ADMIN-GATEWAYS-05
  it("formats success rate and renders a degraded row", () => {
    seeded.mockReturnValue({ data: ROWS, provenance: "live", offline: false, cachedAt: null });
    const { container } = render(<GatewaysTable gateways={ROWS} source="api" />);
    expect(screen.getByText("98.7%")).toBeInTheDocument();
    expect(screen.getByText("1,500")).toBeInTheDocument();
    expect(container.querySelector(".pill.warn")).toHaveTextContent(/degraded/i);
    expect(container.querySelector(".pill.bad")).toHaveTextContent(/down/i);
  });
});
