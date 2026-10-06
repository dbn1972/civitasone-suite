import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});

let mockRoles: string[] = ["tenant_admin"];
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => mockRoles }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import AiPluginsPage from "./page";

const PLUGIN = {
  id: "attrition-prediction",
  name: "Employee Attrition Risk",
  description: "Predicts attrition",
  category: "prediction",
  model: "XGBoost",
  enabled: true,
  mode: "shadow",
  confidenceThreshold: 50,
  predictionCount30d: 10,
  avgConfidence: 0, // a real zero — must render "0%", not "—"
  avgLatencyMs: 12,
  accuracy: null,
  lastPredictionAt: null,
  requiresTraining: false,
  autoAction: false,
  dataSource: "employees",
};

const SUMMARY = { totalPlugins: 14, activePlugins: 1, predictionsToday: 3, predictions30d: 10, avgConfidence7d: 0 };

function mockOk() {
  fetchJsonMock.mockImplementation((url: string) =>
    url.includes("/summary")
      ? Promise.resolve({ data: SUMMARY, source: "api" })
      : Promise.resolve({ data: [PLUGIN], source: "api" }),
  );
}

describe("AiPluginsPage", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); mockRoles = ["tenant_admin"]; });

  it("GAP-TENANT-ADMIN-AI-PLUGINS-02: a failed load shows a retry state and '—' stats, not zeros", async () => {
    fetchJsonMock.mockImplementation((url: string) =>
      url.includes("/summary")
        ? Promise.resolve({ data: { totalPlugins: 0, activePlugins: 0, predictionsToday: 0, predictions30d: 0, avgConfidence7d: null }, source: "error" })
        : Promise.resolve({ data: [], source: "error" }),
    );
    render(await AiPluginsPage());
    expect(screen.getByText(/couldn't load AI plugins/i)).toBeInTheDocument();
    // Total Models stat shows "—" not "0".
    expect(screen.getByText("Total Models").closest(".stat")).toHaveTextContent("—");
  });

  it("GAP-TENANT-ADMIN-AI-PLUGINS-04: a real avgConfidence of 0 renders '0%', not '—'", async () => {
    mockOk();
    render(await AiPluginsPage());
    expect(screen.getByText("Avg Confidence").closest(".stat")).toHaveTextContent("0%");
  });

  it("GAP-TENANT-ADMIN-AI-PLUGINS-06: the predictions card is labelled '(24h)'", async () => {
    mockOk();
    render(await AiPluginsPage());
    expect(screen.getByText(/Predictions \(24h\)/i)).toBeInTheDocument();
  });

  it("GAP-TENANT-ADMIN-AI-PLUGINS-05: the confidence bar is a labelled meter", async () => {
    mockOk();
    const { container } = render(await AiPluginsPage());
    const meter = container.querySelector("[role='meter']");
    expect(meter).not.toBeNull();
    expect(meter!.getAttribute("aria-valuenow")).toBe("50");
    expect(meter!.getAttribute("aria-label")).toMatch(/Confidence threshold for Employee Attrition Risk/i);
  });

  it("GAP-TENANT-ADMIN-AI-PLUGINS-01/03: tenant-admin sees config controls; a plain employee does not", async () => {
    mockOk();
    const { rerender } = render(await AiPluginsPage());
    expect(screen.getByLabelText(/Mode/i)).toBeInTheDocument();

    mockRoles = ["employee"];
    rerender(await AiPluginsPage());
    expect(screen.queryByLabelText(/Mode/i)).not.toBeInTheDocument();
    // Honest subtitle for a read-only viewer.
    expect(screen.getByText(/Monitor machine learning models/i)).toBeInTheDocument();
  });
});
