import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils/intl-render";

/**
 * F6-01 — the SR detail page fetches GET /history and renders the timeline.
 * The mock keys on the URL so detail and history calls return different shapes.
 */
const fetchJsonMock = vi.fn();
vi.mock("../../../../_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

vi.mock("@/lib/auth/roleGuard", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/roleGuard")>();
  return { ...actual, getSessionRoles: () => ["crm_admin"] };
});
vi.mock("../../../../_components/DataSourceBadge", () => ({ DataSourceBadge: () => <div /> }));
vi.mock("./ServiceRequestActions", () => ({ ServiceRequestActions: () => <div data-testid="actions" /> }));

import Page from "./page";

const detail = {
  id: "sr-1",
  referenceNo: "SRQ/2026/ABC123",
  citizenName: "Asha Rao",
  serviceType: "Birth Certificate",
  subject: "Certificate correction",
  priority: "normal",
  status: "resolved",
  resolution: "Issued",
  resolvedAt: "2026-09-05T09:00:00.000Z",
  version: 2,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-05T09:00:00.000Z",
};

const history = [
  { id: "h1", fromStatus: null, toStatus: "open", note: null, actorId: "a", at: "2026-09-01T10:00:00.000Z" },
  { id: "h2", fromStatus: "open", toStatus: "resolved", note: "Issued", actorId: "a", at: "2026-09-05T09:00:00.000Z" },
];

beforeEach(() => {
  fetchJsonMock.mockReset();
  fetchJsonMock.mockImplementation((url: string) => {
    if (typeof url === "string" && url.endsWith("/history")) {
      return Promise.resolve({ data: history, source: "api" });
    }
    return Promise.resolve({ data: detail, source: "api" });
  });
});

describe("F6-01 SR detail timeline wiring", () => {
  it("renders the status timeline card from the history endpoint", async () => {
    render(await Page({ params: Promise.resolve({ id: "sr-1" }) }));
    expect(screen.getByText("Status timeline")).toBeInTheDocument();
    // The history note shows up in the timeline (plus the resolution card).
    expect(screen.getAllByText("Issued").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Opened")).toBeInTheDocument();
  });

  // GAP-CRM-SERVICE-REQUESTS-DETAIL-03: the timeline names who acted, using what the history
  // endpoint resolved (actorName) - the entry's actorId is never rendered.
  it("shows who made each status change, by the name the history endpoint resolved", async () => {
    fetchJsonMock.mockImplementation((url: string) => {
      if (typeof url === "string" && url.endsWith("/history")) {
        return Promise.resolve({
          data: [
            { ...history[0], actorId: "9f1c0b2a-1111-2222-3333-444455556666", actorName: "Meera Nair" },
            { ...history[1], actorId: "9f1c0b2a-1111-2222-3333-444455556666", actorName: "Rahul Verma" },
          ],
          source: "api",
        });
      }
      return Promise.resolve({ data: detail, source: "api" });
    });
    render(await Page({ params: Promise.resolve({ id: "sr-1" }) }));
    expect(screen.getByText("by Meera Nair")).toBeInTheDocument();
    expect(screen.getByText("by Rahul Verma")).toBeInTheDocument();
    expect(screen.queryByText(/9f1c0b2a/)).not.toBeInTheDocument();
  });

  it("calls fetchJson for both the detail and the history endpoints", async () => {
    await Page({ params: Promise.resolve({ id: "sr-1" }) });
    const urls = fetchJsonMock.mock.calls.map((c) => c[0] as string);
    // The detail is requested masked (?maskPii=true) so PII is only ever shown via the audited reveal.
    expect(urls.some((u) => u.endsWith("/service-requests/sr-1?maskPii=true"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/service-requests/sr-1/history"))).toBe(true);
  });
});
