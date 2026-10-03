import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => mockRoles }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import EditLocationPage from "./page";

const LOC = { id: "S", name: "State HQ", type: "state", parentId: null, status: "active", addressLine: null, city: "Delhi", postalCode: "110001", lgdCode: null };
const ALL = [
  LOC,
  { id: "D", name: "District One", type: "district", parentId: "S", status: "active" },
  { id: "O", name: "Other State", type: "state", parentId: null, status: "active" },
  { id: "X", name: "Closed Office", type: "office", parentId: null, status: "archived" },
];

async function renderPage(id = "S") {
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{await EditLocationPage({ params: { id } })}</NextIntlClientProvider>);
}

describe("EditLocationPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    mockRoles = ["hr_admin"];
    fetchJsonMock.mockImplementation(async (url: string, fallback: unknown, o?: { mapResponse?: (p: unknown) => unknown }) =>
      url.includes("?limit=") ? { data: o?.mapResponse?.({ data: ALL }), source: "api" } : { data: o?.mapResponse?.(LOC), source: "api" });
  });

  it("blocks roles the service would refuse, without fetching", async () => {
    mockRoles = ["employee"];
    await renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("renders the edit form prefilled", async () => {
    await renderPage();
    expect(screen.getByLabelText(/^name/i)).toHaveValue("State HQ");
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("does not offer a location, its descendants or an archived one as its parent (cycle + archive protection)", async () => {
    // a state has no parent field; edit a district-level node to see the options
    fetchJsonMock.mockImplementation(async (url: string, _f: unknown, o?: { mapResponse?: (p: unknown) => unknown }) =>
      url.includes("?limit=") ? { data: o?.mapResponse?.({ data: ALL }), source: "api" }
        : { data: o?.mapResponse?.({ ...LOC, type: "office", parentId: null }), source: "api" });
    await renderPage();
    const options = Array.from(document.querySelectorAll("select option")).map((o) => o.textContent);
    expect(options).not.toContain("State HQ");      // itself
    expect(options).not.toContain("District One");  // descendant would form a cycle
    expect(options).not.toContain("Closed Office"); // archived
  });

  it("a missing location shows the not-found state", async () => {
    fetchJsonMock.mockImplementation(async () => ({ data: null, source: "error", status: 404 }));
    await renderPage("nope");
    expect(screen.getByRole("heading", { name: "Location not found" })).toBeInTheDocument();
  });
});
