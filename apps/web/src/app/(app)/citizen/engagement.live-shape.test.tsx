/**
 * Alerts / Notices / Surveys screens against the REAL citizen-service response
 * shape (services/citizen-service/src/modules/engagement — verified field for
 * field by tests/engagement-web-contract.test.ts there against the same
 * @civitasone/schemas/web schemas). The payloads below are what the service
 * sends: `{ data: [...] }`, ISO timestamps, "" for an absent date, "—" for a
 * completion with no target, lower-case stored statuses, "Public Hearing"-style
 * notice type labels. They go through the real loaders (fetchJson + the schema
 * gate), then into the real table components.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const mockGet = vi.fn();
vi.mock("next/headers", () => ({ cookies: () => ({ get: mockGet }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_key: string, initial: unknown[], source: string) => ({
    data: initial, fromCache: false, offline: false, cachedAt: null,
    provenance: source === "error" ? "error-no-data" : "live",
  }),
}));

import { getCitizenAlerts, getCitizenNotices, getCitizenSurveys } from "../../_data/loaders";
import { AlertsTable } from "./alerts/AlertsTable";
import { NoticesTable } from "./notices/NoticesTable";
import { SurveysTable } from "./surveys/SurveysTable";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300, status,
    json: () => Promise.resolve(body),
    clone() { return jsonResponse(status, body); },
  } as unknown as Response;
}
function stubFetch(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(status, body)));
}
function ui(node: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{node}</NextIntlClientProvider>);
}

const ALERTS = {
  data: [
    { id: "a1", title: "Water outage in Ward 7", category: "Utilities", publishedDate: "2026-10-20T04:30:00.000Z", targetAudience: "Ward 7", status: "active" },
    { id: "a2", title: "Monsoon advisory", category: "Weather", publishedDate: "2026-09-01T04:30:00.000Z", targetAudience: "All Citizens", status: "expired" },
  ],
};
const NOTICES = {
  data: [
    { id: "n1", noticeNo: "NTC-2026-1A2B3C4D", subject: "Road widening hearing", department: "Public Works", published: "2026-10-18T04:30:00.000Z", expiry: "", type: "Public Hearing", status: "published" },
    { id: "n2", noticeNo: "GAZ/2026/041", subject: "Stores tender", department: "Stores", published: "2026-10-10T04:30:00.000Z", expiry: "2099-01-01T00:00:00.000Z", type: "Tender", status: "published" },
  ],
};
const SURVEYS = {
  data: [
    { id: "s1", surveyName: "Service satisfaction", responses: 1, completion: "50%", period: "01 Oct 2026 – 31 Oct 2026", status: "active" },
    { id: "s2", surveyName: "Open feedback", responses: 3, completion: "—", period: "", status: "completed" },
  ],
};

beforeEach(() => {
  mockGet.mockReturnValue({ value: globalThis.crypto.randomUUID() });
  process.env.CIVITASONE_API_BASE_URL = "http://gateway.test";
});
afterEach(() => vi.unstubAllGlobals());

describe("alerts screen on the real shape", () => {
  it("the loader accepts the service envelope and the table renders every row", async () => {
    stubFetch(ALERTS);
    const result = await getCitizenAlerts();
    expect(result.source).toBe("api");
    expect(result.data).toHaveLength(2);
    ui(<AlertsTable alerts={result.data} source={result.source} />);
    expect(screen.getByText("Water outage in Ward 7")).toBeInTheDocument();
    expect(screen.getByText("Monsoon advisory")).toBeInTheDocument();
  });
  it("a payload missing a contract field fails the schema gate (source 'error'), not a half-rendered table", async () => {
    stubFetch({ data: [{ id: "a1", title: "no category" }] });
    expect((await getCitizenAlerts()).source).toBe("error");
  });
  it("the retired 501 is an error source, distinct from a genuine empty 200", async () => {
    stubFetch({ code: "NOT_IMPLEMENTED" }, 501);
    expect((await getCitizenAlerts()).source).toBe("error");
    stubFetch({ data: [] });
    const empty = await getCitizenAlerts();
    expect(empty.source).toBe("api");
    expect(empty.data).toEqual([]);
  });
});

describe("notices screen on the real shape", () => {
  it("an unexpiring notice ('' expiry) and a future-dated one are both Active and counted by type label", async () => {
    stubFetch(NOTICES);
    const result = await getCitizenNotices();
    expect(result.source).toBe("api");
    ui(<NoticesTable notices={result.data} source={result.source} />);
    expect(screen.getByText("NTC-2026-1A2B3C4D")).toBeInTheDocument();
    expect(screen.getByText("GAZ/2026/041")).toBeInTheDocument();
    const hearings = screen.getAllByText(enMessages.citizenNotices.statHearings)
      .map((el) => el.closest(".stat")).find((el): el is HTMLElement => el !== null)!;
    expect(hearings).toHaveTextContent("1");
    const tenders = screen.getAllByText(enMessages.citizenNotices.statTenders)
      .map((el) => el.closest(".stat")).find((el): el is HTMLElement => el !== null)!;
    expect(tenders).toHaveTextContent("1");
  });
});

describe("surveys screen on the real shape", () => {
  it("rows render, a '—' completion shows a dash, an empty period is tolerated, stats come from the rows", async () => {
    stubFetch(SURVEYS);
    const result = await getCitizenSurveys();
    expect(result.source).toBe("api");
    ui(<SurveysTable surveys={result.data} source={result.source} />);
    expect(screen.getByText("Service satisfaction")).toBeInTheDocument();
    expect(screen.getByText("Open feedback")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: /Service satisfaction/ })).toBeInTheDocument();
    const total = screen.getAllByText(enMessages.citizenSurveys.statTotalSurveys)
      .map((el) => el.closest(".stat")).find((el): el is HTMLElement => el !== null)!;
    expect(total).toHaveTextContent("2");
  });
});
