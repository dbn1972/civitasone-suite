import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import BenefitsPage from "./page";

async function renderPage() {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{await BenefitsPage()}</NextIntlClientProvider>);
}

describe("BenefitsPage load states (GAP-HR-BENEFITS-03)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("a 403 shows 'Access restricted' with the backend reason and NO Retry button, plus the personal-data note", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error", status: 403, errorMessage: "requires one of: hr_admin, employee" });
    await renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry|try again/i })).toBeNull();
    expect(screen.getByText(/personal to each employee/i)).toBeInTheDocument();
  });

  it("a 500 keeps the generic retryable error and does not claim a permission problem", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error", status: 500 });
    await renderPage();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).toBeNull();
    expect(screen.queryByText(/personal to each employee/i)).toBeNull();
  });

  it("a healthy empty list is an empty state, not an error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).toBeNull();
    expect(screen.queryByText(/personal to each employee/i)).toBeNull();
  });
});
