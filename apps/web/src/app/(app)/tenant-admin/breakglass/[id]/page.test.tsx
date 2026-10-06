import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getBreakglassEventMock = vi.fn();
const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("@/app/_data/loaders", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/loaders")>("@/app/_data/loaders");
  return { ...actual, getBreakglassEvent: (...a: unknown[]) => getBreakglassEventMock(...a) };
});
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import BreakglassDetailPage from "./page";

const realEvent = {
  id: "bg-9",
  actor: "R. Admin",
  actorEmail: "r.admin@example.com",
  reason: "Pool exhaustion investigation",
  startedAt: "2026-02-01T10:00:00Z",
  endedAt: "2026-02-01T12:15:00Z",
  status: "ended",
  closedBy: "c-1",
  closeReason: "Resolved",
  resourcesAccessed: null,
  approvalChain: null,
};

describe("BreakglassDetailPage — FABRICATED (DETAIL-01/04) + DEADROUTE (DETAIL-02)", () => {
  beforeEach(() => {
    getBreakglassEventMock.mockReset();
    notFoundMock.mockClear();
  });

  it("renders the real event, never the hard-coded Vikram Singh sample", async () => {
    getBreakglassEventMock.mockResolvedValue({ data: realEvent, source: "api" });
    render(await BreakglassDetailPage({ params: { id: "bg-9" } }));
    expect(screen.getByText("R. Admin")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Vikram Singh/i);
    expect(document.body.textContent).not.toMatch(/@civitas\.gov\.in/i);
    // No invented resource/approval cards when the API omits them.
    expect(document.body.textContent).not.toMatch(/Resources Accessed/i);
    expect(document.body.textContent).not.toMatch(/Approval Chain/i);
  });

  it("calls notFound() on a 404", async () => {
    getBreakglassEventMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    await expect(BreakglassDetailPage({ params: { id: "nope" } })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("shows an error state (not fabricated data) on a non-404 failure", async () => {
    getBreakglassEventMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    render(await BreakglassDetailPage({ params: { id: "bg-9" } }));
    expect(document.body.textContent).not.toMatch(/Vikram Singh/i);
    expect(notFoundMock).not.toHaveBeenCalled();
  });
});
