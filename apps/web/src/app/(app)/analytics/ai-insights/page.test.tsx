import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("./AiInsightsTable", () => ({
  AiInsightsTable: ({ rows }: { rows: unknown[] }) => <div>ai-table:{rows.length}</div>,
}));

import AiInsightsPage from "./page";

function mockAi(result: { data: unknown; source: "api" | "error" }) {
  fetchJsonMock.mockImplementation((path: unknown) => {
    if (typeof path === "string" && path.includes("/analytics/ai-insights")) return Promise.resolve(result);
    return Promise.resolve({ data: [], source: "api" });
  });
}

const ROWS = [
  { insightTitle: "A", module: "HR", confidence: "84%", generatedDate: "", actionRecommended: "x", status: "New" },
  { insightTitle: "B", module: "Fin", confidence: "n/a", generatedDate: "", actionRecommended: "y", status: "Actioned" },
  { insightTitle: "C", module: "Proc", confidence: "60%", generatedDate: "", actionRecommended: "z", status: "New" },
];

describe("AiInsightsPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("GAP-ANALYTICS-AI-INSIGHTS-03: average confidence ignores unparsable rows (72%, not 48%)", async () => {
    mockAi({ data: ROWS, source: "api" });
    render(await AiInsightsPage());
    expect(screen.getByText("Avg. Confidence").closest(".stat")).toHaveTextContent("72%");
  });

  it("GAP-ANALYTICS-AI-INSIGHTS-02: stat labels are honest ('New'/'Actioned'), not an interactive 'New (Unread)'", async () => {
    mockAi({ data: ROWS, source: "api" });
    render(await AiInsightsPage());
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("Actioned")).toBeInTheDocument();
    expect(screen.queryByText("New (Unread)")).not.toBeInTheDocument();
  });

  it("GAP-ANALYTICS-AI-INSIGHTS-04: empty state is neutral and does not tell a non-admin to change platform settings", async () => {
    mockAi({ data: [], source: "api" });
    render(await AiInsightsPage());
    expect(screen.getByText("No insights yet")).toBeInTheDocument();
    expect(screen.queryByText(/Enable the AI assistant in platform settings/i)).not.toBeInTheDocument();
  });
});
