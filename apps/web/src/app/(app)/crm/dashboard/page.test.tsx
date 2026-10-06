import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../_data/loaders", () => ({ getCRMDashboard: vi.fn() }));
vi.mock("../../../_components/DataSourceBadge", () => ({ DataSourceBadge: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

import Page from "./page";
import { getCRMDashboard } from "../../../_data/loaders";

const mocked = vi.mocked(getCRMDashboard);

const mockDash = { totalContacts: 42, openDeals: 8, activitiesToday: 3, pipelineValue: 1500000 };

beforeEach(() => mocked.mockReset());

describe("CRM Dashboard page (GoI redesign)", () => {
  it("renders StatGrid with correct GoI KPI labels", async () => {
    mocked.mockResolvedValue({ data: mockDash, source: "api" });
    render(await Page());
    expect(screen.getByText("Contacts / Stakeholders")).toBeInTheDocument();
    expect(screen.getByText("Active Engagements")).toBeInTheDocument();
    expect(screen.getByText("Interactions Today")).toBeInTheDocument();
    expect(screen.getByText("Active Engagement Value")).toBeInTheDocument();
  });

  it("renders quick links for Contacts, Engagements, and Activities", async () => {
    mocked.mockResolvedValue({ data: mockDash, source: "api" });
    render(await Page());
    expect(screen.getByText("Contacts")).toBeInTheDocument();
    expect(screen.getByText("Engagements")).toBeInTheDocument();
    expect(screen.getByText("Activities")).toBeInTheDocument();
  });

  it("renders GoI purpose note with role=note", async () => {
    mocked.mockResolvedValue({ data: mockDash, source: "api" });
    render(await Page());
    const note = screen.getByRole("note");
    expect(note).toBeInTheDocument();
    expect(note).toHaveTextContent(/stakeholder/i);
  });

  it("GAP-CRM-DASHBOARD-01: shows '—' for every stat when the load fails", async () => {
    mocked.mockResolvedValue({ data: mockDash, source: "error", status: 500 });
    render(await Page());
    // 4 stat cards all read "—" instead of fabricated 0 / ₹0.00
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
    expect(screen.queryByText("42")).not.toBeInTheDocument();
  });

  it("GAP-CRM-DASHBOARD-01: shows real numbers on success", async () => {
    mocked.mockResolvedValue({ data: mockDash, source: "api" });
    render(await Page());
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
  });

  it("GAP-CRM-DASHBOARD-02: the purpose note no longer calls itself 'not a commercial sales pipeline'", async () => {
    mocked.mockResolvedValue({ data: mockDash, source: "api" });
    render(await Page());
    const note = screen.getByRole("note");
    expect(note).not.toHaveTextContent("not a commercial sales pipeline");
    expect(note).toHaveTextContent(/Engagement Pipeline/);
  });

  it("GAP-CRM-DASHBOARD-03/06: the h1 is the translated 'CRM Dashboard' with no hard-coded Devanagari suffix", async () => {
    mocked.mockResolvedValue({ data: mockDash, source: "api" });
    render(await Page());
    expect(screen.getByRole("heading", { name: "CRM Dashboard" })).toBeInTheDocument();
    // the old hard-coded subtitle suffix is gone
    expect(screen.queryByText(/सरकारी हितधारक पंजी/)).not.toBeInTheDocument();
  });

  it("GAP-CRM-DASHBOARD-04: stat cards link into their lists, incl. Interactions Today -> activities Today segment", async () => {
    mocked.mockResolvedValue({ data: mockDash, source: "api" });
    const { container } = render(await Page());
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/crm/contacts");
    expect(hrefs).toContain("/crm/deals");
    expect(hrefs).toContain("/crm/activities?segment=Today");
  });

  it("GAP-CRM-DASHBOARD-05: the engagements quick link uses 'Engagements' (not 'Deals')", async () => {
    mocked.mockResolvedValue({ data: mockDash, source: "api" });
    render(await Page());
    // the quick-links card uses the same noun as the hub tile
    expect(screen.getAllByText("Engagements").length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "Deals" })).not.toBeInTheDocument();
  });
});
