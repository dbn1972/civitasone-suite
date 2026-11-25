import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const resource = vi.fn();
vi.mock("@/lib/sync/resource", () => ({ useOfflineResource: () => resource() }));

const identity = vi.hoisted(() => ({ roles: ["telephony_supervisor"] as string[], userId: "u9" }));
vi.mock("@/lib/auth/useSessionIdentity", () => ({
  useSessionIdentity: () => ({ loaded: true, userId: identity.userId, roles: identity.roles }),
}));

import TelephonyAgentsPage from "./page";

const refresh = vi.fn();
function agent(over: Record<string, unknown>) {
  return {
    id: "a1", userId: "u1", displayName: "Asha Rao", queueId: null, queueName: null,
    status: "available", extension: "201", version: 3, ...over,
  };
}
function setData(data: unknown[]) {
  resource.mockReturnValue({
    data, source: "live", offline: false, cachedAt: null, loading: false, revalidating: false, error: null, refresh,
  });
}

describe("GAP-TELEPHONY-AGENTS-05 presence override", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resource.mockReset();
    refresh.mockReset();
    identity.roles = ["telephony_supervisor"];
    identity.userId = "u9";
  });

  it("supervisor changes any agent's presence: POSTs status + expectedVersion, then refreshes", async () => {
    setData([agent({})]);
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "a1", status: "accepted" }), { status: 202 }));
    render(<TelephonyAgentsPage />);
    fireEvent.change(screen.getByLabelText(/set presence for asha rao/i), { target: { value: "offline" } });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/telephony/agents/a1/status");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ status: "offline", expectedVersion: 3 });
    expect(await screen.findByText(/status change submitted/i)).toBeInTheDocument();
  });

  it("shows an error and does not refresh when the API rejects", async () => {
    setData([agent({})]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "FORBIDDEN" }), { status: 403 }));
    render(<TelephonyAgentsPage />);
    fireEvent.change(screen.getByLabelText(/set presence for asha rao/i), { target: { value: "busy" } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).not.toBe(""));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a line agent can set only their own presence", () => {
    identity.roles = ["telephony_user"];
    identity.userId = "u1";
    setData([agent({}), agent({ id: "a2", userId: "u2", displayName: "Ravi K" })]);
    render(<TelephonyAgentsPage />);
    expect(screen.getByLabelText(/set presence for asha rao/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/set presence for ravi k/i)).not.toBeInTheDocument();
  });

  it("viewers without a telephony presence role get no control", () => {
    identity.roles = ["finance_officer"];
    setData([agent({})]);
    render(<TelephonyAgentsPage />);
    expect(screen.queryByLabelText(/set presence for/i)).not.toBeInTheDocument();
  });
});
