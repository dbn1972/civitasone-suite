import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const resource = vi.fn();
vi.mock("@/lib/sync/resource", () => ({
  useOfflineResource: () => resource(),
}));

import TelephonyAgentsPage from "./page";

function base(over: Record<string, unknown>) {
  return {
    data: [],
    source: "live",
    offline: false,
    cachedAt: null,
    loading: false,
    revalidating: false,
    error: null,
    refresh: vi.fn(),
    ...over,
  };
}

function agent(over: Record<string, unknown>) {
  return {
    id: "a1",
    userId: "u1",
    displayName: "Asha Rao",
    queueId: "22222222-0000-0000-0000-000000000001",
    queueName: "Ward 7 Complaints",
    status: "available",
    extension: "201",
    ...over,
  };
}

describe("TelephonyAgentsPage", () => {
  beforeEach(() => resource.mockReset());

  // GAP-TELEPHONY-AGENTS-01
  it("shows 'Loading agents…' while the first fetch is pending — not 'saved data'", () => {
    resource.mockReturnValue(base({ data: [], loading: true, source: "cache", cachedAt: null }));
    render(<TelephonyAgentsPage />);
    expect(screen.getByText(/loading agents/i)).toBeInTheDocument();
    expect(screen.queryByText(/showing saved data/i)).not.toBeInTheDocument();
  });

  it("shows an error state with Retry when the first fetch fails and there is no cache", () => {
    resource.mockReturnValue(base({ data: [], error: "boom", source: "cache", cachedAt: null }));
    render(<TelephonyAgentsPage />);
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/showing saved data/i)).not.toBeInTheDocument();
  });

  it("shows 'saved data' only on a real cache hit (cachedAt set)", () => {
    resource.mockReturnValue(
      base({ data: [agent({})], source: "cache", cachedAt: "2026-01-10T00:00:00.000Z", offline: true }),
    );
    render(<TelephonyAgentsPage />);
    expect(screen.getByText(/showing saved data/i)).toBeInTheDocument();
  });

  // GAP-TELEPHONY-AGENTS-02
  it("renders presence pills with the correct DS tone class", () => {
    resource.mockReturnValue(
      base({
        data: [
          agent({ id: "a1", status: "available" }),
          agent({ id: "a2", status: "busy" }),
          agent({ id: "a3", status: "offline" }),
        ],
      }),
    );
    const { container } = render(<TelephonyAgentsPage />);
    expect(container.querySelector(".pill.good")).toBeTruthy(); // available
    expect(container.querySelector(".pill.warn")).toBeTruthy(); // busy
    expect(container.querySelector(".pill.mut")).toBeTruthy(); // offline
  });

  // GAP-TELEPHONY-AGENTS-04
  it("shows the queue name, never a truncated UUID", () => {
    resource.mockReturnValue(base({ data: [agent({ queueName: "Ward 7 Complaints" })] }));
    render(<TelephonyAgentsPage />);
    expect(screen.getByText("Ward 7 Complaints")).toBeInTheDocument();
    expect(screen.queryByText(/22222222/)).not.toBeInTheDocument();
  });

  it("shows 'Unknown queue' for an assigned-but-unresolved queue, and 'Unassigned' when no queue", () => {
    resource.mockReturnValue(
      base({
        data: [
          agent({ id: "a1", queueId: "22222222-0000-0000-0000-000000000001", queueName: null }),
          agent({ id: "a2", queueId: null, queueName: null }),
        ],
      }),
    );
    render(<TelephonyAgentsPage />);
    expect(screen.getByText("Unknown queue")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });
});
