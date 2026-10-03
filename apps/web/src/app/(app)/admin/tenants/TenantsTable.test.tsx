import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const seeded = vi.fn();
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: (...a: unknown[]) => seeded(...a) }));

import { TenantsTable } from "./TenantsTable";

const rows = [
  { id: "1", name: "Alpha", edition: "Government", users: 10, createdDate: "2026-09-12T00:00:00.000Z", status: "active" },
  { id: "2", name: "Beta", edition: "PSU", users: 3, createdDate: "2026-09-13", status: "trial" },
  { id: "3", name: "Gamma", edition: "PSU", users: 0, createdDate: null, status: "suspended" },
];
const tile = (label: string) => screen.getByText(label, { selector: ".lab" }).parentElement as HTMLElement;

describe("TenantsTable (GAP-ADMIN-TENANTS-02/-03/-05)", () => {
  beforeEach(() => seeded.mockReset());

  it("Trial is amber and Suspended red next to a green Active", () => {
    seeded.mockReturnValue({ data: rows, provenance: "live", offline: false, cachedAt: null });
    render(<TenantsTable tenants={rows} />);
    expect(screen.getByText("Active", { selector: ".pill" })).toHaveClass("good");
    expect(screen.getByText("Trial", { selector: ".pill" })).toHaveClass("warn");
    expect(screen.getByText("Suspended", { selector: ".pill" })).toHaveClass("bad");
  });

  it("tiles match the rows shown, including a cached copy behind a failed server read", () => {
    seeded.mockReturnValue({ data: rows, provenance: "cached", offline: false, cachedAt: "2026-10-02T00:00:00.000Z" });
    render(<TenantsTable tenants={[]} source="error" />);
    expect(tile("Total Tenants")).toHaveTextContent("3");
    expect(tile("Trial")).toHaveTextContent("1");
    expect(tile("Suspended")).toHaveTextContent("1");
  });

  it("a failed load with no cache shows dashes and a load-failure empty state, not 'No tenants registered'", () => {
    seeded.mockReturnValue({ data: [], provenance: "error-no-data", offline: false, cachedAt: null });
    render(<TenantsTable tenants={[]} source="error" />);
    expect(tile("Total Tenants")).toHaveTextContent("—");
    expect(screen.getByText("Couldn't load tenants")).toBeInTheDocument();
    expect(screen.queryByText("No tenants registered.")).not.toBeInTheDocument();
  });

  it("a genuinely empty directory keeps the plain empty copy and real zeros", () => {
    seeded.mockReturnValue({ data: [], provenance: "live", offline: false, cachedAt: null });
    render(<TenantsTable tenants={[]} />);
    expect(screen.getByText("No tenants registered.")).toBeInTheDocument();
    expect(tile("Total Tenants")).toHaveTextContent("0");
  });

  it("formats Created as a date, with a dash when missing", () => {
    seeded.mockReturnValue({ data: rows, provenance: "live", offline: false, cachedAt: null });
    render(<TenantsTable tenants={rows} />);
    expect(screen.getByText("12 Sep 2026")).toBeInTheDocument();
    expect(screen.queryByText("2026-09-12T00:00:00.000Z")).not.toBeInTheDocument();
  });
});
