import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

const fetchMock = vi.fn();

import NewJobOpeningPage from "./page";

async function renderPage() {
  const page = await NewJobOpeningPage();
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{page}</NextIntlClientProvider>);
}

describe("NewJobOpeningPage — role gating (Problem A)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("shows an honest permission-denied state for 'employee'", async () => {
    // Regression: POST /v1/hrms/job-openings requires hr_admin/hr_officer/
    // super_admin (recruitment/routes.ts).
    mockRoles = ["employee"];
    await renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(screen.queryByText("New Job Opening")).not.toBeInTheDocument();
  });

  it("denies a manager (can list/view openings via ALL_ROLES, but not create one)", async () => {
    mockRoles = ["manager"];
    await renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
  });

  it("renders the real New Job Opening page for hr_officer", async () => {
    mockRoles = ["hr_officer"];
    await renderPage();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
    expect(screen.getByText("New Job Opening")).toBeInTheDocument();
  });
});
