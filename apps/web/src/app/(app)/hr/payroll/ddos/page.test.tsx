import { describe, it, expect, vi, beforeEach } from "vitest";
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

import DdosPage from "./page";

describe("DdosPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the list of DDOs", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ ddoCode: "DDO01", name: "Directorate of Treasuries", departmentIds: ["d1", "d2"] }],
      source: "api",
    });

    const ui = await DdosPage();
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.getByText("Directorate of Treasuries")).toBeInTheDocument();
  });

  it("renders an empty state when there are no DDOs", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await DdosPage();
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.getByText("No DDOs configured yet")).toBeInTheDocument();
  });

  it("shows the error data-source badge on API failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await DdosPage();
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });
});
