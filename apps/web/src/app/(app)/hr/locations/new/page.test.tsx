import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// Same mocking convention as hr/departments/new/page.test.tsx: control the
// session role directly at the roleGuard module boundary.
let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

// GAP-HR-LOCATIONS-NEW-01: the page now also fetches the location list
// server-side (for the "Add Location" form's parent select), same
// fetchJson-mocking convention as hr/departments/new/page.test.tsx.
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import NewLocationPage from "./page";

async function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {await NewLocationPage()}
    </NextIntlClientProvider>,
  );
}

describe("NewLocationPage — role gating", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
  });

  it("shows an honest permission-denied state for a role the backend would reject", async () => {
    // Regression: POST /v1/locations requires location_user/location_admin/
    // super_admin/admin/hr_admin (location-service's routes.ts) -- "employee"
    // is admitted into /hr by layout.tsx but was never checked here.
    mockRoles = ["employee"];
    await renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^name/i)).not.toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("renders the real Add Location form for hr_admin", async () => {
    mockRoles = ["hr_admin"];
    await renderPage();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^name/i)).toBeInTheDocument();
  });

  it("passes the fetched location list through to the parent-location select", async () => {
    mockRoles = ["location_admin"];
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "s1", name: "Jharkhand", type: "state", parentId: null }],
      source: "api",
    });
    await renderPage();
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(screen.getByLabelText(/^type/i), { target: { value: "district" } });
    expect(screen.getByRole("option", { name: "Jharkhand" })).toBeInTheDocument();
  });

  it("still renders the form (parent select just offers no options) when the location-list fetch fails", async () => {
    mockRoles = ["hr_admin"];
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    await renderPage();
    expect(screen.getByLabelText(/^name/i)).toBeInTheDocument();
  });
});
