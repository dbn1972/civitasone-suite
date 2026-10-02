import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GatewayConfigClient, diffGatewayConfig, jwtModeLabel, validateGatewayConfig } from "./GatewayConfigClient";

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

// GAP-ADMIN-GATEWAY-CONFIG-04
describe("gateway config validation", () => {
  it("empty and out-of-range numbers are errors carrying the bounds; valid config is clean", () => {
    expect(validateGatewayConfig({ ...CONFIG })).toEqual({});
    expect(validateGatewayConfig({ ...CONFIG, rateLimitMax: "" }).rateLimitMax).toMatch(/Global rate limit must be a whole number from 10 to 1,00,000/);
    expect(validateGatewayConfig({ ...CONFIG, authRateLimitMax: 2 }).authRateLimitMax).toMatch(/from 3 to 1,000/);
    expect(validateGatewayConfig({ ...CONFIG, cbFailureThreshold: 1.5 }).cbFailureThreshold).toBeDefined();
  });
});

describe("GatewayConfigClient validation", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url.includes("breakers") ? json({ breakers: [] }) : json({ data: { ...CONFIG } })),
    );
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("clearing Global Rate Limit shows a field error, disables Save and sends no PATCH (it does not become 0)", async () => {
    render(<GatewayConfigClient />);
    const field = (await screen.findByLabelText("Global Rate Limit")) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "" } });
    expect(field.value).toBe("");
    expect(screen.getByText(/Global rate limit must be a whole number/)).toBeInTheDocument();
    const save = screen.getByRole("button", { name: /Fix 1 invalid field/ });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit | undefined)?.method === "PATCH")).toBe(false);
  });

  it("a value below the minimum is rejected client-side with the minimum in the message", async () => {
    render(<GatewayConfigClient />);
    fireEvent.change(await screen.findByLabelText("Auth Rate Limit"), { target: { value: "1" } });
    expect(screen.getByText(/from 3 to 1,000/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Fix 1 invalid field/ })).toBeDisabled();
  });

  // GAP-ADMIN-GATEWAY-CONFIG-05
  it("no hex literal remains and the cards use the responsive grid class", () => {
    const src = readFileSync(join(__dirname, "GatewayConfigClient.tsx"), "utf8");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(src).not.toContain('gridTemplateColumns: "1fr 1fr"');
    expect(src).toContain('className="grid g-2"');
  });

  it("makes no dead /api/ops/breakers call and says breaker status is not available yet", async () => {
    render(<GatewayConfigClient />);
    await screen.findByLabelText("Global Rate Limit");
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("breakers"))).toBe(false);
    expect(screen.getAllByText(/Not available yet/).length).toBeGreaterThan(0);
  });
});
