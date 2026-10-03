import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import enMessages from "@/messages/en.json";

const cookieJar = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: (n: string) => (n === "cand_token" && cookieJar.token ? { value: cookieJar.token } : undefined) }) }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_NOT_FOUND"); },
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT:${url}`); },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("./[id]/ApplyForm", () => ({ ApplyForm: () => <div data-testid="apply-form" /> }));

import CareersPage from "./page";
import VacancyPage from "./[id]/page";
import LoginPage from "./portal/login/page";
import PortalPage from "./portal/page";

const render = (ui: React.ReactElement) => rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

const ORG = { organisationName: "Housing & Urban Development Department", departmentName: "Government of Odisha", emblemUrl: "https://cdn.example.gov.in/emblem.png" };
const VACANCY = { id: "v1", title: "Assistant Engineer", refNo: "R1", vacancyType: "regular", vacancies: 2, applicationOpen: true };

/** Routes the public fetches by URL: vacancies, the single vacancy, the organisation identity. */
function stub(org: unknown) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    if (u.endsWith("/careers/organisation")) return org === "down" ? new Response("{}", { status: 503 }) : new Response(JSON.stringify({ data: org }), { status: 200 });
    if (u.includes("/careers/vacancies/")) return new Response(JSON.stringify(VACANCY), { status: 200 });
    if (u.endsWith("/careers/vacancies")) return new Response(JSON.stringify({ data: [VACANCY] }), { status: 200 });
    return new Response("{}", { status: 404 });
  }));
}

beforeEach(() => { cookieJar.token = undefined; });
afterEach(() => vi.unstubAllGlobals());

describe("one office identity across the public careers pages (HOME-02 / PORTAL-LOGIN-02)", () => {
  it("home, vacancy and sign-in show the SAME configured office name, department and emblem", async () => {
    stub(ORG);
    for (const view of [await CareersPage({ searchParams: {} }), await VacancyPage({ params: { id: "v1" } }), await LoginPage({})]) {
      const { unmount } = render(view);
      const header = screen.getByTestId("careers-org-header");
      expect(header).toHaveTextContent("Housing & Urban Development Department");
      expect(header).toHaveTextContent("Government of Odisha");
      expect(header.querySelector("img")).toHaveAttribute("src", "https://cdn.example.gov.in/emblem.png");
      unmount();
    }
  });

  it("an office that configured nothing gets a neutral header -- never an invented body", async () => {
    stub({ organisationName: null, departmentName: null, emblemUrl: null });
    render(await CareersPage({ searchParams: {} }));
    const header = screen.getByTestId("careers-org-header");
    expect(header).toHaveTextContent("Careers");
    expect(header.querySelector("img")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Government of India/i);
  });

  it("an unreachable identity endpoint degrades to the neutral header and the board still renders", async () => {
    stub("down");
    render(await CareersPage({ searchParams: {} }));
    expect(screen.getByTestId("careers-org-header")).toHaveTextContent("Careers");
    expect(screen.getByText("Assistant Engineer")).toBeInTheDocument();
  });

  it("'Powered by CivitasOne' is small footer text only, not the page identity", async () => {
    stub(ORG);
    render(await CareersPage({ searchParams: {} }));
    const powered = screen.getByText("Powered by CivitasOne");
    expect(powered.closest("footer")).not.toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Join Our Team");
    expect(screen.queryByText("◈")).not.toBeInTheDocument();
  });

  it("the candidate portal list carries the same header", async () => {
    cookieJar.token = `${Buffer.from(JSON.stringify({ tenantId: "t1" })).toString("base64url")}.sig`;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).endsWith("/careers/organisation")
      ? new Response(JSON.stringify({ data: ORG }), { status: 200 })
      : new Response(JSON.stringify({ data: [], total: 0 }), { status: 200 })));
    render(await PortalPage({ searchParams: {} }));
    expect(screen.getByTestId("careers-org-header")).toHaveTextContent("Housing & Urban Development Department");
  });
});

describe("no hard-coded sovereign claim in the careers routes (grep)", () => {
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) return sources(p);
      return /\.(tsx?|json)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
    });
  }
  it("'Government of India' appears in no careers source file", () => {
    const roots = [join(__dirname), join(__dirname, "../api/careers")];
    const offenders = roots.flatMap(sources).filter((p) => /Government of India/i.test(readFileSync(p, "utf8")));
    expect(offenders).toEqual([]);
  });
});
