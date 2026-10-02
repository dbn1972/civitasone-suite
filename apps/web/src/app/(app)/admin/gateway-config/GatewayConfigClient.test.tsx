import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GatewayConfigClient, diffGatewayConfig, jwtModeLabel } from "./GatewayConfigClient";

const CONFIG = {
  jwtEdgeVerify: "true",
  upstreamTimeoutMs: 20000,
  cbFailureThreshold: 5,
  cbRecoveryMs: 30000,
  rateLimitMax: 1000,
  rateLimitTenantMax: 200,
  authRateLimitMax: 10,
  bodyLimitBytes: 1048576,
} as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("gateway config helpers", () => {
  it("labels known JWT modes and never turns an unexpected value into 'Off'", () => {
    expect(jwtModeLabel("true")).toBe("Enforcing");
    expect(jwtModeLabel("audit")).toBe("Audit");
    expect(jwtModeLabel("off")).toBe("Off");
    expect(jwtModeLabel("x")).toBe("Unknown");
  });

  it("diff flags weakening changes as risky", () => {
    const d = diffGatewayConfig({ ...CONFIG }, { ...CONFIG, jwtEdgeVerify: "off", rateLimitMax: 5000, cbFailureThreshold: 3 });
    expect(d.map((c) => [c.key, c.risky])).toEqual([
      ["jwtEdgeVerify", true],
      ["cbFailureThreshold", false],
      ["rateLimitMax", true],
    ]);
    expect(d[0]).toMatchObject({ from: "Enforcing", to: "Off" });
  });
});

describe("GatewayConfigClient", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  // GAP-ADMIN-GATEWAY-CONFIG-01
  it("a failed load shows an error with retry -- never 'Off' or a fabricated '15s'", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url.includes("breakers") ? json({ breakers: [] }) : json({ code: "INTERNAL" }, 500)),
    );
    render(<GatewayConfigClient />);
    await waitFor(() => expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument());
    expect(screen.queryByText("Off")).not.toBeInTheDocument();
    expect(screen.queryByText("15s")).not.toBeInTheDocument();
    expect(screen.queryByText("JWT Verification")).not.toBeInTheDocument();
  });

  it("a real 'off' still shows Off", async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url.includes("breakers") ? json({ breakers: [] }) : json({ data: { ...CONFIG, jwtEdgeVerify: "off" } })),
    );
    render(<GatewayConfigClient />);
    await waitFor(() => expect(screen.getByText("JWT Verification").parentElement).toHaveTextContent("Off"));
  });

  // GAP-ADMIN-GATEWAY-CONFIG-02
  it("Save opens a diff + reason dialog and PATCHes only the changed field with the reason", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("breakers")) return Promise.resolve(json({ breakers: [] }));
      if (init?.method === "PATCH") return Promise.resolve(json({ status: "updated", data: {} }));
      return Promise.resolve(json({ data: { ...CONFIG } }));
    });
    render(<GatewayConfigClient />);
    const save = await screen.findByRole("button", { name: "No changes" });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText("JWT Edge Verification"), { target: { value: "off" } });
    fireEvent.click(screen.getByRole("button", { name: "Review 1 change" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("JWT Edge Verification: Enforcing → Off");
    expect(dialog).toHaveTextContent("weakens protection");
    expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === "PATCH")).toBe(false);

    const apply = screen.getByRole("button", { name: "Apply changes" });
    expect(apply).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason for this change/), { target: { value: "Keycloak outage workaround" } });
    fireEvent.click(apply);
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === "PATCH")).toBe(true));
    const patch = fetchMock.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === "PATCH");
    expect(JSON.parse(String((patch?.[1] as RequestInit).body))).toEqual({ jwtEdgeVerify: "off", reason: "Keycloak outage workaround" });
  });
});
