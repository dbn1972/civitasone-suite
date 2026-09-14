import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import DepartmentsPage from "./page";

const MOCK_DEPTS = [{ id: "d1", code: "FIN", name: "Finance", parentId: null }];

// UX-017 (tranche 3): DepartmentsPage now reads its copy through next-intl
// (getTranslations("departments") server-side, and DepartmentsTable's own
// useTranslations("departmentsTable") client-side once rendered as a
// child) -- both need a real provider in the tree. getTranslations itself
// is handled by the global next-intl/server mock in vitest.setup.ts; this
// wrapper covers the nested client component's useTranslations call, same
// pattern as citizen/grievances/GrievancesTable.test.tsx.
async function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {await DepartmentsPage()}
    </NextIntlClientProvider>,
  );
}

describe("DepartmentsPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders departments and real stat counts on success", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_DEPTS, source: "api" });
    await renderPage();
    expect(screen.getAllByText("Total Departments").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  it("shows the honest empty state when there genuinely are no departments", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByText("No departments yet")).toBeInTheDocument();
  });

  it("shows the error state — not zero stat cards or the empty-state prompt — on a real fetch failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    await renderPage();
    expect(screen.getByText("We couldn't load this departments.")).toBeInTheDocument();
    expect(screen.queryByText("No departments yet")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
