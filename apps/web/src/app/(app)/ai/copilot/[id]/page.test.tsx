import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CopilotTurn } from "@civitasone/types";

class NotFoundSignal extends Error {}
const notFoundMock = vi.fn(() => { throw new NotFoundSignal("NEXT_NOT_FOUND"); });
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const getCopilotTurnMock = vi.fn();
vi.mock("../../../../_data/loaders", async () => {
  const actual = await vi.importActual<typeof import("../../../../_data/loaders")>("../../../../_data/loaders");
  return { ...actual, getCopilotTurn: (id: string) => getCopilotTurnMock(id) };
});

import CopilotTurnPage from "./page";

function turn(over: Partial<CopilotTurn> = {}): CopilotTurn {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    userId: null,
    prompt: "Summarise the pending sanctions",
    response: "Three sanctions are pending approval.",
    sourceCitations: [],
    model: "gpt-4o",
    tokens: 120,
    latencyMs: 400,
    createdAt: "2026-08-01T10:00:00.000Z",
    version: 1,
    ...over,
  };
}

const params = { id: "11111111-1111-1111-1111-111111111111" };

describe("CopilotTurnPage (GAP-AI-COPILOT-DETAIL-01/02/04/05)", () => {
  beforeEach(() => { getCopilotTurnMock.mockReset(); notFoundMock.mockClear(); });

  it("DETAIL-01: a non-404 error renders a retry state, not 'Turn not found'", async () => {
    getCopilotTurnMock.mockResolvedValue({ data: null, source: "error", status: 503 });
    render(await CopilotTurnPage({ params }));
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("DETAIL-01: a real 404 calls notFound()", async () => {
    getCopilotTurnMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    await expect(CopilotTurnPage({ params })).rejects.toBeInstanceOf(NotFoundSignal);
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("DETAIL-04: an awaiting turn says the page updates automatically, not 'reload'", async () => {
    getCopilotTurnMock.mockResolvedValue({ data: turn({ response: null }), source: "api", status: 200 });
    render(await CopilotTurnPage({ params }));
    expect(screen.getByText(/updates automatically/i)).toBeInTheDocument();
    expect(screen.queryByText(/Reload this page/i)).not.toBeInTheDocument();
    // Sources card must not claim "answered without citing" before an answer exists
    expect(screen.queryByText(/answered without citing/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Sources appear once the answer is ready/i)).toBeInTheDocument();
  });

  it("DETAIL-02: a javascript: citation URL renders as plain text, no live link", async () => {
    getCopilotTurnMock.mockResolvedValue({
      data: turn({ sourceCitations: [{ id: "c1", title: "Evil", url: "javascript:alert(1)", score: 0.5 }] }),
      source: "api",
      status: 200,
    });
    render(await CopilotTurnPage({ params }));
    expect(screen.getByText("Evil")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Evil" })).not.toBeInTheDocument();
  });

  it("DETAIL-02/05: an https citation renders as a link and the score shows as a percentage", async () => {
    getCopilotTurnMock.mockResolvedValue({
      data: turn({ sourceCitations: [{ id: "c1", title: "Doc", url: "https://x.gov.in/a", score: 0.874 }] }),
      source: "api",
      status: 200,
    });
    render(await CopilotTurnPage({ params }));
    expect(screen.getByRole("link", { name: "Doc" })).toHaveAttribute("href", "https://x.gov.in/a");
    expect(screen.getByText("87% match")).toBeInTheDocument();
  });
});
