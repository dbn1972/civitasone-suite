import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import enMessages from "@/messages/en.json";
import { middleware } from "@/middleware";
import { NextRequest } from "next/server";

// UAT-P2-D3 (A11Y-19, GIGW 3.0): the footer links to these three public pages.
// Review of #2447: they must exist, render the gigw.* strings, carry clearly
// marked DEFERRED-content placeholders and be reachable without signing in.
vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => (key: string) => (enMessages as unknown as Record<string, Record<string, string>>)[ns]?.[key] ?? key,
}));

import AccessibilityStatementPage from "../accessibility-statement/page";
import ScreenReaderAccessPage from "../screen-reader-access/page";
import WebsitePoliciesPage from "../website-policies/page";

const gigw = enMessages.gigw as Record<string, string>;

describe("GIGW compliance pages (A11Y-19)", () => {
  it("accessibility statement: heading, intro, pending notice and placeholder sections", async () => {
    const { container } = render(await AccessibilityStatementPage());
    expect(screen.getByRole("heading", { level: 1, name: gigw.accessibilityTitle })).toBeInTheDocument();
    expect(screen.getByText(gigw.accessibilityIntro)).toBeInTheDocument();
    expect(container.querySelector('[data-deferred-content="page"]')).toHaveTextContent(gigw.pendingNotice);
    for (const h of ["conformanceHeading", "knownIssuesHeading", "feedbackHeading", "statementDateHeading"]) {
      expect(screen.getByRole("heading", { level: 2, name: gigw[h] })).toBeInTheDocument();
    }
    expect(screen.getAllByText(gigw.pendingSection)).toHaveLength(4);
  });

  it("website policies: the six GIGW policy sections, each a marked placeholder", async () => {
    const { container } = render(await WebsitePoliciesPage());
    expect(screen.getByRole("heading", { level: 1, name: gigw.policiesTitle })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(6);
    expect(container.querySelectorAll("[data-deferred-content]").length).toBe(7);
  });

  it("screen reader access: a captioned table of screen readers", async () => {
    render(await ScreenReaderAccessPage());
    expect(screen.getByRole("heading", { level: 1, name: gigw.screenReaderTitle })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: gigw.screenReaderTitle });
    expect(table).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "NVDA" })).toBeInTheDocument();
    expect(screen.getAllByText(gigw.srFree).length).toBeGreaterThanOrEqual(1);
  });

  it.each(["/accessibility-statement", "/screen-reader-access", "/website-policies"])(
    "%s is public (no login redirect)",
    async (path) => {
      const res = await middleware(new NextRequest(new URL(path, "http://localhost:3000")));
      expect(res.headers.get("location") ?? "").not.toContain("/auth/login");
    },
  );
});
