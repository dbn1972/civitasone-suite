import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
const getSessionRolesMock = vi.fn();
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => getSessionRolesMock(),
}));

import JdTemplatesPage from "./page";

const NEW_ID = "7d3f1c52-9b0e-4a64-8f21-6c5d4e3b2a10";

const TEMPLATE = (over: Record<string, unknown> = {}) => ({
  id: "11111111-2222-4333-8444-555555555555", name: "Junior Analyst", vacancyType: "internship",
  useCount: 2, createdAt: "2026-10-01T00:00:00Z", ...over,
});

async function renderPage(searchParams: { type?: string; created?: string } = {}) {
  const ui = await JdTemplatesPage({ searchParams });
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("JdTemplatesPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReset();
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
  });

  // GAP-HR-JD-TEMPLATES-06
  it("renders the type badge from translations, not a hard-coded English label (GAP-HR-JD-TEMPLATES-06)", async () => {
    fetchJsonMock.mockResolvedValue({
      source: "api",
      data: [
        TEMPLATE({ id: "a1", name: "T1", vacancyType: "volunteership" }),
        TEMPLATE({ id: "a2", name: "T2", vacancyType: "deputation" }),
      ],
    });
    await renderPage();
    const c1 = screen.getByRole("heading", { name: "T1" }).closest("article") as HTMLElement;
    expect(within(c1).getByText("Volunteer")).toBeInTheDocument();
    const c2 = screen.getByRole("heading", { name: "T2" }).closest("article") as HTMLElement;
    expect(within(c2).getByText("Deputation")).toBeInTheDocument();
  });

  it("shows an unrecognised vacancy type as-is rather than hiding it", async () => {
    fetchJsonMock.mockResolvedValue({ source: "api", data: [TEMPLATE({ vacancyType: "secondment" })] });
    await renderPage();
    expect(screen.getByText("secondment")).toBeInTheDocument();
  });

  it("'New template' button has no literal plus in its text; the plus is a separate aria-hidden icon (GAP-HR-JD-TEMPLATES-06)", async () => {
    fetchJsonMock.mockResolvedValue({ source: "api", data: [TEMPLATE()] });
    await renderPage();
    const link = screen.getByRole("link", { name: /New template/ });
    expect(link).toHaveTextContent("+ New template");
    expect(within(link).getByText("+")).toHaveAttribute("aria-hidden", "true");
  });

  // GAP-HR-JD-TEMPLATES-NEW-01
  describe("just-created template (?created=)", () => {
    it("highlights the card and marks it 'Just added' once it is in the list", async () => {
      fetchJsonMock.mockResolvedValue({ source: "api", data: [TEMPLATE({ id: NEW_ID, name: "Brand New" }), TEMPLATE({ id: "b2", name: "Older" })] });
      await renderPage({ created: NEW_ID });

      const card = screen.getByRole("heading", { name: "Brand New" }).closest("article") as HTMLElement;
      expect(card).toHaveAttribute("aria-current", "true");
      expect(within(card).getByText("Just added")).toBeInTheDocument();
      const other = screen.getByRole("heading", { name: "Older" }).closest("article") as HTMLElement;
      expect(other).not.toHaveAttribute("aria-current");
      expect(screen.queryByTestId("jd-template-pending")).not.toBeInTheDocument();
    });

    it("shows a pending row, not a lost-save-looking list, when the consumer has not inserted it yet", async () => {
      fetchJsonMock.mockResolvedValue({ source: "api", data: [TEMPLATE({ id: "b2", name: "Older" })] });
      await renderPage({ created: NEW_ID });

      const pending = screen.getByTestId("jd-template-pending");
      expect(pending).toHaveTextContent("New template on its way");
      expect(within(pending).getByRole("link", { name: "Refresh" })).toHaveAttribute("href", `/hr/jd-templates?created=${NEW_ID}`);
      expect(screen.getByRole("heading", { name: "Older" })).toBeInTheDocument();
    });

    it("shows the pending row instead of the 'No templates yet' empty state for a first-ever template", async () => {
      fetchJsonMock.mockResolvedValue({ source: "api", data: [] });
      await renderPage({ created: NEW_ID });

      expect(screen.getByTestId("jd-template-pending")).toBeInTheDocument();
      expect(screen.queryByText("No templates yet")).not.toBeInTheDocument();
    });

    it("does not show a pending row under a type filter that could legitimately exclude the new template", async () => {
      fetchJsonMock.mockResolvedValue({ source: "api", data: [] });
      await renderPage({ created: NEW_ID, type: "regular" });
      expect(screen.queryByTestId("jd-template-pending")).not.toBeInTheDocument();
    });

    it("ignores a malformed ?created= value", async () => {
      fetchJsonMock.mockResolvedValue({ source: "api", data: [] });
      await renderPage({ created: "not-a-uuid<script>" });
      expect(screen.queryByTestId("jd-template-pending")).not.toBeInTheDocument();
      expect(screen.getByText("No templates yet")).toBeInTheDocument();
    });
  });

  it("denies a non-HR session before fetching anything", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    await renderPage();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });
});
