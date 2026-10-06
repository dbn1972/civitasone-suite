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
    render(await Page({ params: { id: "sr-1" } }));
    expect(screen.getByText("Status timeline")).toBeInTheDocument();
    // The history note shows up in the timeline (plus the resolution card).
    expect(screen.getAllByText("Issued").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Opened")).toBeInTheDocument();
  });

  it("calls fetchJson for both the detail and the history endpoints", async () => {
    await Page({ params: { id: "sr-1" } });
    const urls = fetchJsonMock.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => u.endsWith("/service-requests/sr-1"))).toBe(true);
    expect(urls.some((u) => u.endsWith("/service-requests/sr-1/history"))).toBe(true);
  });
});
