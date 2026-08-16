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
});
