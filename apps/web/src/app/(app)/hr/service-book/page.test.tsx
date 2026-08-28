import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import ServiceBookPage from "./page";

describe("ServiceBookPage", () => {
  it("requests the tenant-wide list when no employee is specified", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await ServiceBookPage({}));
    expect(fetchJsonMock).toHaveBeenCalledWith("/api/v1/hrms/service-book", [], expect.anything());
    expect(screen.getByRole("heading", { name: "Service Book" })).toBeInTheDocument();
  });

  it("scopes the request to one employee via ?empId= (previously ignored entirely)", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "e1", employee: "Priya Nair", eventType: "transfer", effectiveDate: "2026-01-01" }],
      source: "api",
    });
    render(await ServiceBookPage({ searchParams: { empId: "emp-42" } }));
    expect(fetchJsonMock).toHaveBeenCalledWith(
      "/api/v1/hrms/service-book?employeeId=emp-42",
      [],
      expect.anything(),
    );
    expect(screen.getByRole("heading", { name: /service book — priya nair/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view all employees/i })).toHaveAttribute("href", "/hr/service-book");
  });
});
