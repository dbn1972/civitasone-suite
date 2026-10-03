import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render as rtlRender, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const cookieJar = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: (n: string) => (n === "cand_token" && cookieJar.token ? { value: cookieJar.token } : undefined) }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
}));

import PortalPage from "./page";


// The page chrome includes the language switcher (a client component), so renders need the intl provider the
// root layout supplies in production.
function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const goodToken = `${Buffer.from(JSON.stringify({ tenantId: "t1" })).toString("base64url")}.sig`;
const app = (o: Record<string, unknown> = {}) => ({
  id: "11111111-2222-3333-4444-555555555555", applicationNo: "REC/2026/0042", jobTitle: "Assistant", jobLocation: "Bhubaneswar",
  jobRefNo: "R1", stage: "applied", status: "active", appliedAt: "2026-03-01T10:00:00Z", ...o,
});
function stub(res: Response | Error) {
  const f = vi.fn(async () => { if (res instanceof Error) throw res; return res.clone(); });
  vi.stubGlobal("fetch", f);
  return f;
}
const list = (data: unknown[], total = data.length) => new Response(JSON.stringify({ data, total }), { status: 200 });
async function open(sp?: { page?: string }) { return render(await PortalPage({ searchParams: sp })); }

beforeEach(() => { cookieJar.token = goodToken; });
afterEach(() => { vi.unstubAllGlobals(); });

describe("candidate portal list", () => {
  // GAP-RECRUITMENT-CAREERS-PORTAL-03
  it("a 401 (expired/invalid token) redirects to login with expired=1 instead of the retry card", async () => {
    stub(new Response("{}", { status: 401 }));
    await expect(open()).rejects.toThrow("NEXT_REDIRECT:/careers/portal/login?expired=1");
  });
  it("a 500 still shows the retry state", async () => {
    stub(new Response("{}", { status: 500 }));
    await open();
    expect(screen.getByText(/Couldn.t load your applications/)).toBeTruthy();
  });
  it("a network failure shows the retry state", async () => {
    stub(new Error("down"));
    await open();
    expect(screen.getByRole("link", { name: /Try again/ })).toBeTruthy();
  });

  // GAP-RECRUITMENT-CAREERS-PORTAL-04
  it("a malformed cookie redirects to login and never reaches the empty state or the network", async () => {
    cookieJar.token = "garbage";
    const f = stub(list([]));
    await expect(open()).rejects.toThrow("NEXT_REDIRECT:/careers/portal/login?expired=1");
    expect(f).not.toHaveBeenCalled();
  });

  // GAP-RECRUITMENT-CAREERS-PORTAL-08
  it("the upstream fetch carries an abort signal so a stalled gateway cannot hang the render", async () => {
    const f = stub(list([app()]));
    await open();
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  // GAP-RECRUITMENT-CAREERS-PORTAL-02
  it("a rejected application shows 'Not selected' with a message and no progress rail, never the raw word", async () => {
    stub(list([app({ stage: "rejected" })]));
    const { container } = await open();
    expect(screen.getAllByText("Not selected").length).toBeGreaterThan(0);
    expect(screen.getByText(/was not selected for this post/i)).toBeTruthy();
    expect(container.querySelector("ol")).toBeNull();
    expect(container.textContent).not.toMatch(/\brejected\b/);
  });
  it("an unknown stage renders 'In progress', not the raw string", async () => {
    stub(list([app({ stage: "foo" })]));
    const { container } = await open();
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(container.textContent).not.toContain("foo");
  });

  // GAP-RECRUITMENT-CAREERS-PORTAL-05
  it("the rail is an ordered list with aria-current on the active step and text states", async () => {
    stub(list([app({ stage: "shortlisted" })]));
    const { container } = await open();
    const ol = screen.getByRole("list", { name: /application progress/i });
    const current = ol.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toContain("Shortlisted");
    expect(ol.textContent).toContain("(completed)");
    expect(ol.textContent).toContain("(upcoming)");
    expect(container.innerHTML).not.toMatch(/#e07b00|224, 123, 0/i);
    const link = screen.getByRole("link", { name: /Assistant, status Shortlisted/ });
    expect(link).toBeTruthy();
  });

  // GAP-RECRUITMENT-CAREERS-PORTAL-06
  it("a null location renders no 'India', and a missing job title is not the fabricated 'Unknown Position'", async () => {
    stub(list([app({ jobLocation: null, jobTitle: null })]));
    const { container } = await open();
    expect(container.textContent).not.toContain("India");
    expect(container.textContent).not.toContain("Unknown Position");
    expect(screen.getByText("Position no longer listed")).toBeTruthy();
    expect(container.textContent).toContain("R1");
  });

  // GAP-RECRUITMENT-CAREERS-PORTAL-07
  it("shows the applied date on each card and pages with ?page=", async () => {
    const f = stub(list([app()], 45));
    await open({ page: "2" });
    expect(screen.getByText(/Applied on 1 Mar 2026/)).toBeTruthy();
    const url = (f.mock.calls[0] as unknown as [string])[0];
    expect(url).toContain("limit=20");
    expect(url).toContain("offset=20");
    expect(screen.getByText("Page 2 of 3")).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: /pagination/i });
    expect(within(nav).getByRole("link", { name: /Older/ }).getAttribute("href")).toBe("/careers/portal?page=3");
    expect(within(nav).getByRole("link", { name: /Newer/ }).getAttribute("href")).toBe("/careers/portal?page=1");
  });

  it("clamps a huge ?page so the offset sent upstream stays bounded", async () => {
    const f = stub(list([app()], 45));
    await open({ page: "99999999999999" });
    const url = (f.mock.calls[0] as unknown as [string])[0];
    expect(Number(new URL(url).searchParams.get("offset"))).toBeLessThanOrEqual(9980);
  });

  it("past the last page (empty page, total > 0) redirects to the last page, not 'No applications yet'", async () => {
    stub(list([], 45));
    await expect(open({ page: "9" })).rejects.toThrow("NEXT_REDIRECT:/careers/portal?page=3");
  });

  it("a genuinely empty account (total 0) still shows 'No applications yet'", async () => {
    stub(list([], 0));
    await open();
    expect(screen.getByText("No applications yet")).toBeTruthy();
  });
});
