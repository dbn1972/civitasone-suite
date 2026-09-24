import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import ServiceBookPage from "./page";

// UX-017 (tranche 3): ServiceBookPage now reads its copy through next-intl
// (getTranslations("serviceBook") server-side; ServiceBookView's own
// useTranslations("serviceBookView") client-side once rendered as a child)
// -- see departments/page.test.tsx's renderPage() comment for why both
// need a real provider in the tree.
async function renderPage(props: Parameters<typeof ServiceBookPage>[0]) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {await ServiceBookPage(props)}
    </NextIntlClientProvider>,
  );
}

describe("ServiceBookPage", () => {
  it("requests the tenant-wide list when no employee is specified", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage({});
    expect(fetchJsonMock).toHaveBeenCalledWith("/api/v1/hrms/service-book", [], expect.anything());
    expect(screen.getByRole("heading", { name: "Service Book" })).toBeInTheDocument();
  });

  it("scopes the request to one employee via ?empId= (previously ignored entirely)", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "e1", employee: "Priya Nair", eventType: "transfer", effectiveDate: "2026-01-01" }],
      source: "api",
    });
    await renderPage({ searchParams: { empId: "emp-42" } });
    expect(fetchJsonMock).toHaveBeenCalledWith(
      "/api/v1/hrms/service-book?employeeId=emp-42",
      [],
      expect.anything(),
    );
    expect(screen.getByRole("heading", { name: /service book — priya nair/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view all employees/i })).toHaveAttribute("href", "/hr/service-book");
  });

  // UX-01x: GET /v1/hrms/service-book is scoped to hr_admin/hr_officer/
  // super_admin/manager (services/hrms-service/src/modules/service-book/routes.ts) --
  // an "employee" role gets a specific 403, which used to render as the
  // same misleading "couldn't load, try again" panel as a real outage.
  it("shows an honest 'Access restricted' message (not the generic retry message) when the backend returns 403", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [],
      source: "error",
      status: 403,
      errorMessage: "requires one of: hr_admin, hr_officer, super_admin, manager",
    });

    await renderPage({});

    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(
      screen.getByText("Requires one of: hr_admin, hr_officer, super_admin, manager."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("still shows the generic 'try again' message for a genuine transient failure (no status -- e.g. a network error)", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    await renderPage({});

    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
  });
});
