import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getCustomDomains = vi.fn();
vi.mock("@/app/_data/loaders", () => ({ getCustomDomains: () => getCustomDomains() }));

import DomainsPage from "./page";

async function renderPage() {
  render(await DomainsPage());
}

// /domains must call GET /v1/admin/custom-domains (via getCustomDomains) and render the result.
describe("DomainsPage", () => {
  beforeEach(() => getCustomDomains.mockReset());

  it("renders the fetched custom domains", async () => {
    getCustomDomains.mockResolvedValue({
      source: "api",
      data: [
        { id: "d1", domain: "portal.example.gov.in", status: "active", verificationMethod: "dns_txt", verificationToken: "t", sslStatus: "issued", sslExpiresAt: null, createdAt: "2026-11-01T00:00:00Z" },
        { id: "d2", domain: "erp.example.nic.in", status: "pending_verification", verificationMethod: "dns_cname", verificationToken: "t", sslStatus: "pending", sslExpiresAt: null, createdAt: "2026-11-02T00:00:00Z" },
      ],
    });
    await renderPage();
    expect(getCustomDomains).toHaveBeenCalledTimes(1);
    expect(screen.getByText("portal.example.gov.in")).toBeInTheDocument();
    expect(screen.getByText("erp.example.nic.in")).toBeInTheDocument();
    expect(screen.getByText("Pending verification")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Register New Domain/i })[0]).toHaveAttribute("href", "/domains/new");
  });

  it("shows a proper empty state when no domains are registered", async () => {
    getCustomDomains.mockResolvedValue({ source: "api", data: [] });
    await renderPage();
    expect(screen.getByText("No domains registered yet")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows the standard load-error state on failure, not a fake empty list", async () => {
    getCustomDomains.mockResolvedValue({ source: "error", status: 500, data: [] });
    await renderPage();
    expect(screen.queryByText("No domains registered yet")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Domains" })).toBeInTheDocument();
  });
});
