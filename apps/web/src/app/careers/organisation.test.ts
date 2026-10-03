import { describe, it, expect, vi, afterEach } from "vitest";
import { NO_ORG, getCareersOrg, parseOrganisation, safeEmblemUrl } from "./organisation";

afterEach(() => vi.unstubAllGlobals());

describe("parseOrganisation", () => {
  it("reads the configured identity from the public envelope", () => {
    expect(parseOrganisation({ data: { organisationName: " Government of Odisha ", departmentName: "H&UD Department", emblemUrl: "https://cdn.example/e.png" } }))
      .toEqual({ organisationName: "Government of Odisha", departmentName: "H&UD Department", emblemUrl: "https://cdn.example/e.png" });
  });
  it("anything unconfigured or malformed is the neutral header, not an invented name", () => {
    expect(parseOrganisation({ data: { organisationName: null, departmentName: null, emblemUrl: null } })).toEqual(NO_ORG);
    expect(parseOrganisation({ data: [] })).toEqual(NO_ORG); // e.g. a vacancies list answering the same URL
    expect(parseOrganisation(null)).toEqual(NO_ORG);
    expect(parseOrganisation({ data: { organisationName: 42 } })).toEqual(NO_ORG);
  });
});

describe("safeEmblemUrl", () => {
  it("allows https and site-absolute paths only", () => {
    expect(safeEmblemUrl("https://x.gov.in/e.png")).toBe("https://x.gov.in/e.png");
    expect(safeEmblemUrl("/static/emblem.svg")).toBe("/static/emblem.svg");
    for (const bad of ["javascript:alert(1)", "data:image/png;base64,AA", "//evil.example/e.png", "http://x/e.png", "", "  "]) expect(safeEmblemUrl(bad), bad).toBeNull();
  });
});

describe("getCareersOrg", () => {
  it("sends the tenant header and returns the parsed identity", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ data: { organisationName: "State Dept", departmentName: null, emblemUrl: null } }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const org = await getCareersOrg();
    expect(org.organisationName).toBe("State Dept");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/v1/careers/organisation");
    expect((init.headers as Record<string, string>)["x-tenant-id"]).toBeTruthy();
  });
  it("falls back to the neutral header on a failure or an outage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    expect(await getCareersOrg()).toEqual(NO_ORG);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await getCareersOrg()).toEqual(NO_ORG);
  });
});
