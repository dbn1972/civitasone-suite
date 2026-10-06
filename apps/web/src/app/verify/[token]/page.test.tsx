import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import PublicVerifyPage from "./page";

describe("Public certificate verify page (GAP-CITIZEN-CERTIFICATES-01)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("calls the gateway PUBLIC verify endpoint (not /api/proxy) and shows the verdict", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ found: true, validity: "valid", certNo: "CERT-7", certType: "birth_certificate", status: "active", validTo: "2030-01-01" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    render(await PublicVerifyPage({ params: { token: "abc" } }));

    // It must hit the gateway's public verify route, never the session-gated proxy.
    const firstCall = fetchMock.mock.calls[0] as unknown[] | undefined;
    const url = String(firstCall?.[0] ?? "");
    expect(url).toContain("/api/v1/citizen/certificates/verify/abc");
    expect(url).not.toContain("/api/proxy");

    expect(screen.getByText("Certificate is valid")).toBeInTheDocument();
    expect(screen.getByText("Birth Certificate")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("shows a not-found verdict for an unknown token (404)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof fetch);
    render(await PublicVerifyPage({ params: { token: "nope" } }));
    expect(screen.getByText("Certificate not found")).toBeInTheDocument();
  });

  it("shows a graceful error (not a crash) when the gateway is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }) as unknown as typeof fetch);
    render(await PublicVerifyPage({ params: { token: "x" } }));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
