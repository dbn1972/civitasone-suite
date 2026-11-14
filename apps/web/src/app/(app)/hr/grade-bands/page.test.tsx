import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => mockRoles }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
const loadBands = vi.fn();
vi.mock("@/app/_data/gradeBands", () => ({
  getGradeBands: (...a: unknown[]) => loadBands(...a),
  getPayScaleKind: async () => "private_bands",
}));

import GradeBandsPage from "./page";

async function renderPage() {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{await GradeBandsPage()}</NextIntlClientProvider>);
}

describe("GradeBandsPage (S8-G4)", () => {
  beforeEach(() => {
    loadBands.mockReset();
    loadBands.mockResolvedValue({ failed: false, bands: [{ id: "b1", code: "C2", name: "Consultant 2", rank: 20, track: "Technical", ctcMinMinor: null, ctcMaxMinor: null, noticeDays: null, isActive: true, version: 1, designationCount: 0 }] });
  });

  it("denies a plain employee before loading anything", async () => {
    mockRoles = ["employee"];
    await renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(loadBands).not.toHaveBeenCalled();
  });

  it("an HR admin gets the stats, the table and the controls", async () => {
    mockRoles = ["hr_admin"];
    await renderPage();
    expect(screen.getByText("Total Bands")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /new band/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /private grade bands/i })).toBeChecked();
  });

  it("an hr_officer can read the bands but gets no write controls (the API is admin-only for writes)", async () => {
    mockRoles = ["hr_officer"];
    await renderPage();
    expect(screen.getByText("Consultant 2")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /new band/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("a failed load shows the error state, not zeros or the empty prompt", async () => {
    mockRoles = ["hr_admin"];
    loadBands.mockResolvedValue({ failed: true, bands: [] });
    await renderPage();
    expect(screen.queryByText("No grade bands yet")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
