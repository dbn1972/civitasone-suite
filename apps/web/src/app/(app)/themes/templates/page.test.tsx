import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

// GAP-THEMES-TEMPLATES-05 (CAP/UX-TABLE): pin that the templates list page
// renders through ModuleListPage -> ModuleListTable -> DS DataTable and so
// inherits a search box, sortable headers, a pager and a StatusPill Status
// column. Previously PARTIAL (full DataTable swap deferred); landed on main.
// Fails on the old bare-<table> code.
const templates = vi.fn();
vi.mock("../_data", () => ({ getThemeTemplates: () => templates() }));
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("@/messages/en.json")).default;
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: "en", messages, namespace: namespace as never }),
  };
});

import Page from "./page";

const rows = Array.from({ length: 16 }, (_, i) => ({
  id: `tpl-${String(i + 1).padStart(2, "0")}`,
  label: i === 0 ? "Zenith template" : `Template ${i + 1}`,
  sublabel: `desc ${i + 1}`,
  status: i === 0 ? "published" : "draft",
  meta: `C${i + 1}`,
}));

beforeEach(() => {
  templates.mockReset().mockResolvedValue({ data: rows, source: "api" });
});

describe("Themes templates page (GAP-THEMES-TEMPLATES-05)", () => {
  it("inherits the DataTable search box, sortable Name header, pager and StatusPill", async () => {
    render(await Page());
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    expect(screen.getByText("Name", { selector: "th" })).toHaveAttribute("aria-sort");
    expect(screen.getByText(/Page 1 of 2/i)).toBeInTheDocument();
    expect(screen.getByText("Published")).toHaveClass("pill");
  });

  it("the search box narrows the visible rows", async () => {
    render(await Page());
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Zenith template" } });
    const body = document.querySelector("tbody") as HTMLElement;
    expect(within(body).getByText("Zenith template")).toBeInTheDocument();
    expect(within(body).queryByText("Template 2")).not.toBeInTheDocument();
  });
});

// GAP-THEMES-TEMPLATES-02: showId={false} — ID column must not appear on the
// templates list; truncated UUID prefixes are meaningless to clerks.
describe("Themes templates page — showId (GAP-THEMES-TEMPLATES-02)", () => {
  it("does NOT render an ID column header", async () => {
    render(await Page());
    expect(screen.queryByRole("columnheader", { name: /^id$/i })).not.toBeInTheDocument();
  });

  it("rows are identified by Name, not truncated ID", async () => {
    render(await Page());
    const body = document.querySelector("tbody") as HTMLElement;
    expect(within(body).getByText("Zenith template")).toBeInTheDocument();
    expect(within(body).queryByText("tpl-01")).not.toBeInTheDocument();
  });
});

// GAP-THEMES-TEMPLATES-01 / owner decision #38 (2026-10-26): the rows are
// document templates (email / letter / certificate), not theme presets, so the
// page says so honestly; theme presets come after UAT.
describe("Themes templates page - honest document-template labelling (decision #38)", () => {
  it("titles the page as document templates and states they are not theme presets", async () => {
    render(await Page());
    expect(screen.getByRole("heading", { name: /document templates/i })).toBeInTheDocument();
    expect(screen.getByText(/email, letter and certificate/i)).toBeInTheDocument();
    expect(screen.getByText(/not theme presets/i)).toBeInTheDocument();
  });

  it("no longer promises ready-made looks", async () => {
    render(await Page());
    expect(screen.queryByText(/ready-made looks/i)).not.toBeInTheDocument();
  });
});
