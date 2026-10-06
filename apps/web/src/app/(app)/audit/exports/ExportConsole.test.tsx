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
      if (url === "/api/proxy/v1/audit/exports") {
        return new Response(JSON.stringify({ id: "exp-1", status: "accepted", correlationId: "c1" }), { status: 202 });
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

    expect(await screen.findByText(/We couldn't connect\. Check your internet connection and try again\./)).toBeInTheDocument();
    expect(screen.queryByText(/backend timed out/)).not.toBeInTheDocument();
  });

  // GAP-AUDIT-EXPORTS-01: create must POST to the v1 proxy path and read the id
  // from the accepted envelope (data.id ?? id).
  it("POSTs the create to /api/proxy/v1/audit/exports and reads data.id", async () => {
    const seen: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      seen.push(url);
      if (url === "/api/proxy/v1/audit/exports") {
        return new Response(
          JSON.stringify({ id: "flat-ignored", status: "accepted", correlationId: "c1", data: { id: "env-9" } }),
          { status: 202 },
        );
      }
      if (url.startsWith("/api/proxy/v1/audit/exports/env-9")) {
        return new Response(JSON.stringify({ data: { id: "env-9", status: "processing", format: "json", ready: false, download: null, rowCount: null, includesPii: false, retentionUntil: null, expiresAt: null, error: null, contentSha256: null, signature: null, signatureAlg: null, signingKeyId: null, signedAt: null } }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<ExportConsole canExportPii={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Generate export" }));
    await waitFor(() => expect(screen.getByText("Generate signed audit export?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    // The job id taken from data.id must appear in the Current job card.
    await waitFor(() => expect(screen.getByText("env-9")).toBeInTheDocument());
    expect(seen).toContain("/api/proxy/v1/audit/exports");
    expect(seen.some((u) => u === "/api/proxy/audit/exports")).toBe(false);
  });

  // GAP-AUDIT-EXPORTS-02: PII checkbox disabled for roles that cannot export PII.
  it("disables the PII checkbox when the role cannot export PII", () => {
    render(<ExportConsole canExportPii={false} />);
    const cb = screen.getByRole("checkbox", { name: /Include PII columns/i });
    expect(cb).toBeDisabled();
  });

  // GAP-AUDIT-EXPORTS-02: with PII included, the confirm dialog demands a reason
  // and that reason is sent in the create payload.
  it("requires a reason for a PII export and sends it in the POST body", async () => {
    let createBody: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/proxy/v1/audit/exports") {
        createBody = JSON.parse(String(init?.body ?? "{}"));
        return new Response(JSON.stringify({ id: "p-1", status: "accepted", correlationId: "c1", data: { id: "p-1" } }), { status: 202 });
      }
      if (url.startsWith("/api/proxy/v1/audit/exports/p-1")) {
        return new Response(JSON.stringify({ data: { id: "p-1", status: "processing", format: "json", ready: false, download: null, rowCount: null, includesPii: true, retentionUntil: null, expiresAt: null, error: null, contentSha256: null, signature: null, signatureAlg: null, signingKeyId: null, signedAt: null } }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<ExportConsole canExportPii />);
    fireEvent.click(screen.getByRole("checkbox", { name: /Include PII columns/i }));
    fireEvent.click(screen.getByRole("button", { name: "Generate export" }));
    await waitFor(() => expect(screen.getByText("Generate signed audit export?")).toBeInTheDocument());

    // The reason field must be present (requireReason). Confirm with a reason.
    const reason = screen.getByRole("textbox");
    fireEvent.change(reason, { target: { value: "Regulator SEBI request #42" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    await waitFor(() => expect(createBody).not.toBeNull());
    expect(createBody).toMatchObject({ includePii: true, reason: "Regulator SEBI request #42" });
  });

  // GAP-AUDIT-EXPORTS-05: a running job persisted in sessionStorage resumes
  // polling on mount, so a page reload does not lose the Current job.
  it("resumes polling from sessionStorage on mount", async () => {
    window.sessionStorage.setItem("audit.exports.currentJob", "resumed-7");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/proxy/v1/audit/exports/resumed-7")) {
        return new Response(JSON.stringify({ data: { id: "resumed-7", status: "processing", format: "json", ready: false, download: null, rowCount: null, includesPii: false, retentionUntil: null, expiresAt: null, error: null, contentSha256: null, signature: null, signatureAlg: null, signingKeyId: null, signedAt: null } }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<ExportConsole />);
    expect(await screen.findByText("resumed-7")).toBeInTheDocument();
    window.sessionStorage.removeItem("audit.exports.currentJob");
  });
});
