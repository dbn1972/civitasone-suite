/**
 * GAP-RECRUITMENT-CAREERS-PORTAL-APPLICATION-DETAIL-03 / -04 / -05 / -08: the server page's failure handling and
 * vacancy panel. The page is an async server component, so it is invoked directly with its framework seams mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import enMessages from "@/messages/en.json";

const H = vi.hoisted(() => ({ cookie: "" as string | undefined }));

vi.mock("next/headers", () => ({ cookies: () => ({ get: () => (H.cookie ? { value: H.cookie } : undefined) }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => createTranslator({ locale: "en", messages: enMessages as never, namespace: ns as never }),
}));

import ApplicationDetailPage from "./page";

const token = `${Buffer.from(JSON.stringify({ tenantId: "t-1" })).toString("base64url")}.sig`;
const base = {
  id: "11111111-1111-4111-8111-111111111111", applicationNo: "APP-2026-AB12CD", stage: "applied", status: "active", appliedAt: "2026-03-01T10:00:00.000Z",
  outcome: null, timeline: [{ stage: "applied", label: "Application Submitted", status: "active", note: "2026-03-01T10:00:00.000Z" }],
  job: { id: "j", title: "Junior Engineer", refNo: "REF-1", location: null, description: null, payRange: null, vacancies: 0, closesAt: "2099-12-31" },
};

const render_ = async () => render(await ApplicationDetailPage({ params: { id: base.id } }));
const stub = (status: number, body: unknown = base) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));

describe("candidate portal application detail page", () => {
  beforeEach(() => { H.cookie = token; });
  afterEach(() => vi.unstubAllGlobals());

  it("redirects to sign-in when there is no cookie", async () => {
    H.cookie = undefined;
    await expect(ApplicationDetailPage({ params: { id: base.id } })).rejects.toThrow("NEXT_REDIRECT:/careers/portal/login");
  });

  it("redirects an expired / rejected session (401) back to login instead of a 404", async () => {
    stub(401, {});
    await expect(ApplicationDetailPage({ params: { id: base.id } })).rejects.toThrow("NEXT_REDIRECT:/careers/portal/login?expired=1");
  });

  it("shows a retry card (not a 404) when the service fails", async () => {
    stub(500, {});
    await render_();
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't load this application/i);
    expect(screen.getByRole("link", { name: "Try again" })).toHaveAttribute("href", `/careers/portal/application/${base.id}`);
  });

  it("keeps notFound() for a real 404", async () => {
    stub(404, {});
    await expect(ApplicationDetailPage({ params: { id: base.id } })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders no stray '0' for zero vacancies and no invented 'India' location", async () => {
    stub(200);
    const { container } = await render_();
    expect(container.textContent).not.toMatch(/India/);
    // Header sub-line carries only the ref (no location).
    expect(container.querySelector("p")?.textContent).toBe("REF-1");
    // No bare "0" node anywhere in the Vacancy Details grid.
    const grid = screen.getByText("Vacancy Details").parentElement!;
    expect(grid.textContent).not.toMatch(/(^|[^\d])0([^\d]|$)/);
  });

  it("labels the closing date by whether it has passed, in IST format", async () => {
    stub(200);
    const { unmount } = await render_();
    expect(screen.getByText("Applications close")).toBeInTheDocument();
    expect(screen.getByText("31 Dec 2099")).toBeInTheDocument();
    unmount();
    stub(200, { ...base, job: { ...base.job, closesAt: "2020-01-05" } });
    await render_();
    expect(screen.getByText("Closed on")).toBeInTheDocument();
  });
});
