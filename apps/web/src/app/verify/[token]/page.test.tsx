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

  // GAP2-SHELL-VERIFY-01: the page must use design-system tokens so a dark-mode
  // client is not forced into a hard-coded light card. These assertions fail on
  // the old code, which used literal hex (#ecfdf3/#fffaeb/#fef3f2) + system-ui.
  it("styles the verdict with DS status tokens, not hard-coded hex", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ found: true, validity: "valid", certNo: "CERT-1" }), { status: 200 }),
      ) as unknown as typeof fetch,
    );
    const { container } = render(await PublicVerifyPage({ params: { token: "abc" } }));
    const html = container.innerHTML;
    // valid verdict -> --good* tokens; no literal hex, no forced system-ui.
    expect(html).toContain("var(--good");
    expect(html).toContain("var(--bg)");
    expect(html).not.toMatch(/#ecfdf3|#fffaeb|#fef3f2/i);
    expect(html).not.toContain("system-ui");
  });

  it("uses the warn token for an expired certificate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ found: true, validity: "expired", certNo: "CERT-2" }), { status: 200 }),
      ) as unknown as typeof fetch,
    );
    const { container } = render(await PublicVerifyPage({ params: { token: "abc" } }));
    expect(container.innerHTML).toContain("var(--warn");
  });
});
