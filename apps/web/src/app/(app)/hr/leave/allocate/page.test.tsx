import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

// AllocateLeaveForm fetches employees + leave-types on mount via plain
// fetch() (not the fetchJson loader), same as its own test file
// (AllocateLeaveForm.test.tsx) — stub global fetch so it resolves quietly
// rather than rejecting and logging noise in the authorized-role test.
const fetchMock = vi.fn();

import AllocateLeavePage from "./page";

async function renderPage() {
  const page = await AllocateLeavePage();
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{page}</NextIntlClientProvider>);
}

describe("AllocateLeavePage — role gating (Problem A)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("shows an honest permission-denied state for 'employee'", async () => {
    // Regression: POST /v1/hrms/leave-allocations requires hr_admin/
    // hr_officer/super_admin (leave/routes.ts) — "employee" is in
    // leave/routes.ts's ALL_ROLES (can apply for/view leave) but not its
    // HR_ROLES (cannot allocate leave to others).
    mockRoles = ["employee"];
    await renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(screen.queryByText("Allocate Leave")).not.toBeInTheDocument();
  });

  it("denies a manager too (allocation is HR_ROLES-only, unlike leave application)", async () => {
    mockRoles = ["manager"];
    await renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
  });

  it("renders the real Allocate Leave form for hr_admin", async () => {
    mockRoles = ["hr_admin"];
    await renderPage();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
    // getByText would be ambiguous: the page <h1> and the form's own submit
    // button share the exact same "Allocate Leave" label.
    expect(screen.getByRole("heading", { name: "Allocate Leave" })).toBeInTheDocument();
  });
});
