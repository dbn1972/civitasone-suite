import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});
vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => (key: string) => `${ns}.${key}`,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import Page from "./page";

function mockRequests(result: { data: unknown; source: "api" | "error" }) {
  fetchJsonMock.mockImplementation((path: unknown) => {
    if (typeof path === "string" && path.includes("/citizen/requests")) return Promise.resolve(result);
    return Promise.resolve({ data: [], source: "api" });
  });
}

async function renderPage() {
  const ui = await Page();
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("CitizenRequests Page — GAP-CITIZEN-REQUESTS-01 (FAILMASK)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("shows a retry affordance (not zero stats + 'No service requests') when the loader fails", async () => {
    mockRequests({ data: [], source: "error" });
    await renderPage();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    // No stat grid rendered on error (the server-translated label would be
    // "citizenRequests.statOpen").
    expect(screen.queryByText("citizenRequests.statOpen")).not.toBeInTheDocument();
  });

  it("renders stats + table when the loader succeeds", async () => {
    mockRequests({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByText("citizenRequests.statOpen")).toBeInTheDocument();
  });
});
