import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "tmpl-1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/notifications/templates/tmpl-1",
  useSearchParams: () => new URLSearchParams(),
}));

import TemplateDetailPage from "./page";

function version(partial: Record<string, unknown>) {
  return {
    id: "v1", channel: "email", name: "Payslip ready", subject: "Your payslip",
    body: "Hello", status: "active", version: 1, supersededBy: null,
    createdAt: "2026-01-15T19:00:00.000Z", createdBy: "aaaaaaaa-1111-2222-3333-444444444444",
    ...partial,
  };
}

describe("TemplateDetailPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the current template version on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([version({})]), { status: 200 }),
    );
    render(<TemplateDetailPage />);
    expect(await screen.findByText("Payslip ready")).toBeInTheDocument();
  });

  it("shows a clerk-safe load error, not the raw HTTP_<status> sentinel, when the fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    render(<TemplateDetailPage />);
    expect(await screen.findByText("Couldn't load this template")).toBeInTheDocument();
    expect(screen.queryByText(/HTTP_500/)).not.toBeInTheDocument();
  });

  it("DETAIL-02: picks the highest version as current regardless of API order", async () => {
    // API returns oldest-first (v1 then v3); current must be v3.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([
        version({ id: "v1", version: 1, subject: "Old subject", supersededBy: "v3" }),
        version({ id: "v3", version: 3, subject: "New subject", supersededBy: null }),
      ]), { status: 200 }),
    );
    render(<TemplateDetailPage />);
    // "New subject" (v3) is the current version; it appears in the current card
    // AND its history row, so expect at least one. "Old subject" (v1) only
    // appears in history, never as the current card's subject.
    const news = await screen.findAllByText("New subject");
    expect(news.length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Old subject").length).toBe(1);
  });

  it("DETAIL-01: active template CTA links to compose with the templateId", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([version({ id: "v9", version: 1, supersededBy: null, status: "active" })]), { status: 200 }),
    );
    render(<TemplateDetailPage />);
    const cta = await screen.findByRole("link", { name: /send with this template/i });
    expect(cta.getAttribute("href")).toBe("/notifications/compose?templateId=v9");
  });

  it("DETAIL-03: superseded current version disables the CTA and links to the replacement", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([
        version({ id: "v2", version: 2, status: "superseded", supersededBy: "v3" }),
      ]), { status: 200 }),
    );
    render(<TemplateDetailPage />);
    // No active send link; a disabled button instead.
    expect(await screen.findByRole("button", { name: /send with this template/i })).toBeDisabled();
    expect(screen.getByRole("link", { name: /open the current version/i }).getAttribute("href")).toBe("/notifications/templates/v3");
  });
});
