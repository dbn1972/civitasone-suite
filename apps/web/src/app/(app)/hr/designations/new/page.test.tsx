import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

// S8-G4: the page is now async (it asks for the tenant's pay scale). Government default here.
vi.mock("@/app/_data/gradeBands", () => ({
  getPayScaleKind: async () => "cpc7",
  getGradeBands: async () => ({ bands: [], failed: false }),
}));

import NewDesignationPage from "./page";

async function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {await NewDesignationPage()}
    </NextIntlClientProvider>,
  );
}

describe("NewDesignationPage — role gating (Problem A)", () => {
  it("shows an honest permission-denied state for 'employee' instead of a live-but-doomed form", async () => {
    mockRoles = ["employee"];
    await renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(screen.queryByText("Add Designation")).not.toBeInTheDocument();
  });

  it("renders the real Add Designation form for hr_admin", async () => {
    mockRoles = ["hr_admin"];
    await renderPage();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
    // "Add Designation" text is ambiguous here (page heading, form-internal
    // heading, and submit button all share it) — the Code field is the
    // unambiguous signal the real form rendered.
    expect(screen.getByLabelText(/code/i)).toBeInTheDocument();
  });

  it("denies hr_officer (masters-routes.ts's HR_ROLES excludes it)", async () => {
    mockRoles = ["hr_officer"];
    await renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
  });
});
