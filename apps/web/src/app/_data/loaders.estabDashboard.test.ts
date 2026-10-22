import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The real fetchJson runs here (cookie + base URL stubbed, only the network faked), so a payload goes
// through EstabDashboardSchema.safeParse and then mapEstabDashboard exactly as it does in production.
const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockGet }),
}));

import { EstabDashboardSchema } from "@civitasone/schemas/web";
import { getEstabDashboard } from "./loaders";

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

function serve(payload: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(status, payload)));
}

const REST = { meetingsToday: 1, vehiclesInUse: 2, complianceItemsDue: 3, slaBreached: 4, dakPending: 5, avgPendencyDays: 6 };

// GAP-ESTAB-DASHBOARD-02: the count of status=active files is `filesActive`; `filesPending` is only the old alias.
describe("getEstabDashboard field names", () => {
  beforeEach(() => {
    mockGet.mockReturnValue({ value: "fake-access-token" });
    process.env.CIVITASONE_API_BASE_URL = "http://gateway.test";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CIVITASONE_API_BASE_URL;
  });

  it("reads filesActive", async () => {
    serve({ filesActive: 9, filesPending: 9, ...REST });
    const { data, source } = await getEstabDashboard();
    expect(source).toBe("api");
    expect(data.filesActive).toBe(9);
  });

  it("falls back to the deprecated filesPending alias from a service that does not send filesActive yet", async () => {
    // New web, estab-service not yet redeployed: the schema must not invent a 0 that hides the alias.
    serve({ filesPending: 4, ...REST });
    const { data, source } = await getEstabDashboard();
    expect(source).toBe("api");
    expect(data.filesActive).toBe(4);
  });

  it("prefers filesActive over the alias when both are present", async () => {
    serve({ filesActive: 3, filesPending: 99, ...REST });
    expect((await getEstabDashboard()).data.filesActive).toBe(3);
  });

  it("reads a real 0 when the service sends filesActive: 0", async () => {
    serve({ filesActive: 0, filesPending: 0, ...REST });
    expect((await getEstabDashboard()).data.filesActive).toBe(0);
  });

  it("reads 0 when neither field is sent", async () => {
    serve({ ...REST });
    expect((await getEstabDashboard()).data.filesActive).toBe(0);
  });

  it("maps the other counts unchanged", async () => {
    serve({ filesActive: 1, ...REST });
    expect((await getEstabDashboard()).data).toMatchObject(REST);
  });

  it("is an error, not a zero, when the payload is not the dashboard shape", async () => {
    serve({ filesActive: "x", ...REST });
    const { source } = await getEstabDashboard();
    expect(source).toBe("error");
  });
});

describe("EstabDashboardSchema", () => {
  it("leaves an absent filesActive / filesPending undefined instead of defaulting it to 0", () => {
    const parsed = EstabDashboardSchema.parse({ filesPending: 4, ...REST });
    expect(parsed.filesActive).toBeUndefined();
    expect(parsed.filesPending).toBe(4);
    expect(EstabDashboardSchema.parse({ filesActive: 2, ...REST }).filesPending).toBeUndefined();
  });
});
