import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ExportConsole } from "./ExportConsole";

describe("ExportConsole", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // UX-016: `generate`'s not-ok branch used to build the error from `Export
  // request rejected (${status}). ${rawResponseText}` verbatim, and it was
  // surfaced via ActionButton's own generic catch (`e.message`). It must now
  // show only the catalogued, clerk-safe copy — never the raw server text.
  it("shows a clerk-safe error, not the raw server text, when generating an export fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("audit-service: WORM bucket unreachable: ECONNREFUSED 10.0.4.12:443", { status: 502 }),
    );

    render(<ExportConsole />);
    fireEvent.click(screen.getByRole("button", { name: "Generate export" }));
    await waitFor(() => expect(screen.getByText("Generate signed audit export?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument();
    expect(screen.queryByText(/WORM bucket unreachable/)).not.toBeInTheDocument();
  });

  // UX-016: runVerify's not-ok branch used to build the error from `Verify
  // failed (${status}). ${rawResponseText}` verbatim, and its catch used to
  // read the caught exception's own `.message` directly. It must now show
  // only the catalogued, clerk-safe copy — never the raw server text.
  it("shows a clerk-safe error, not the raw server text, when integrity verification fails", async () => {
    const STATUS_BODY = {
      id: "exp-1",
      status: "completed",
      format: "json",
      ready: true,
      download: "tok-1",
      rowCount: 42,
      includesPii: false,
      retentionUntil: null,
      expiresAt: null,
      error: null,
      contentSha256: "abc123",
      signature: "sig",
      signatureAlg: "HMAC-SHA256",
      signingKeyId: "key-1",
      signedAt: "2026-09-17T00:00:00.000Z",
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/proxy/audit/exports") {
        return new Response(JSON.stringify({ id: "exp-1" }), { status: 200 });
      }
      if (url === "/api/proxy/v1/audit/exports/exp-1/verify") {
        return new Response("signature verification backend timed out", { status: 504 });
      }
      if (url === "/api/proxy/v1/audit/exports/exp-1") {
        // Polled status check — resolves immediately as completed so the
        // "Verify integrity" action becomes available without waiting on
        // the component's own poll interval.
        return new Response(JSON.stringify({ data: STATUS_BODY }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<ExportConsole />);
    fireEvent.click(screen.getByRole("button", { name: "Generate export" }));
    await waitFor(() => expect(screen.getByText("Generate signed audit export?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Verify integrity" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Verify integrity" }));

    expect(await screen.findByText(/couldn't (load|check)/i)).toBeInTheDocument();
    expect(screen.queryByText(/backend timed out/)).not.toBeInTheDocument();
  });
});
