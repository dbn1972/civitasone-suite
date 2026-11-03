import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockGet }),
  headers: () => new Headers(),
}));

import { getTenantConfig, getCurrentTenantOrgType } from "./loaders";
import { getTenantOverview } from "../(app)/tenant/_data";
import { getThemeBranding } from "../(app)/themes/_data";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    clone() {
      return jsonResponse(status, body);
    },
  } as unknown as Response;
}

// UAT-P2-D1 root cause: for the UAT office (tenant 11111111-...-0001) the
// owning services hold no tenant / branding record yet and answer a typed
// 404 NOT_FOUND. These four screens rendered that as "We couldn't load ...".
// They now resolve it as an honest empty state; any other failure (and a
// gateway routing 404) is still an error.
describe("platform screen loaders treat a service NOT_FOUND as empty (UAT-P2-D1)", () => {
  beforeEach(() => {
    mockGet.mockReturnValue({ value: "fake-access-token" });
    process.env.CIVITASONE_API_BASE_URL = "http://gateway.test";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CIVITASONE_API_BASE_URL;
  });

  const notFound = (message: string) => vi.fn().mockResolvedValue(jsonResponse(404, { code: "NOT_FOUND", message }));

  it("tenant-config: 404 -> no configuration on record (data null, source api)", async () => {
    vi.stubGlobal("fetch", notFound("no configuration is on record for this office"));
    const r = await getTenantConfig();
    expect(r.source).toBe("api");
    expect(r.data).toBeNull();
    expect(r.status).toBe(404);
  });

  it("org-type: 404 -> unset org type with no tenant id (selector read-only)", async () => {
    vi.stubGlobal("fetch", notFound("tenant not found"));
    const r = await getCurrentTenantOrgType();
    expect(r.source).toBe("api");
    expect(r.data).toEqual({ tenantId: null, orgType: null, settings: {} });
  });

  it("tenant overview: 404 -> empty profile list", async () => {
    vi.stubGlobal("fetch", notFound("tenant not found"));
    const r = await getTenantOverview();
    expect(r.source).toBe("api");
    expect(r.data).toEqual([]);
  });

  it("themes branding: 404 'branding not configured' -> empty list", async () => {
    vi.stubGlobal("fetch", notFound("branding not configured"));
    const r = await getThemeBranding();
    expect(r.source).toBe("api");
    expect(r.data).toEqual([]);
  });

  it("a 500 is still an error for each of them", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { code: "INTERNAL", message: "internal error" })));
    for (const r of [await getTenantConfig(), await getCurrentTenantOrgType(), await getTenantOverview(), await getThemeBranding()]) {
      expect(r.source).toBe("error");
    }
  });
});
