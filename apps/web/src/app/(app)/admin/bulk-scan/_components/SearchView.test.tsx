import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { SearchView } from "./SearchView";
import { jsonResponse, renderIntl } from "./testHelpers";

const hit = { documentId: "d1", fileName: "pay.pdf", docType: "pay_slip", snippetMasked: "Salary of XXXX XXXX 1234 and acct 123456789012", confidence: 0.91, filedAt: "2026-09-01T10:00:00.000Z", links: [{ target: "hr_employee", targetId: "EMP-1" }] };

describe("SearchView", () => {
  const f = vi.fn();
  beforeEach(() => { f.mockReset(); vi.stubGlobal("fetch", f); });
  afterEach(() => vi.unstubAllGlobals());
  const docTypes = [{ id: "pay_slip", label: "Pay slip" }];

  it("idle prompt first; a too-short query is rejected before any request", () => {
    renderIntl(<SearchView docTypes={docTypes} />);
    expect(screen.getByText("Search filed documents")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search text"), { target: { value: "a" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByText("Enter at least 2 characters.")).toBeInTheDocument();
    expect(f).not.toHaveBeenCalled();
  });

  it("results show masked snippets, confidence with text, link chips; stray long digit runs are masked again", async () => {
    f.mockResolvedValue(jsonResponse(200, { data: [hit], pagination: { hasMore: false, pageSize: 20 } }));
    renderIntl(<SearchView docTypes={docTypes} />);
    fireEvent.change(screen.getByLabelText("Search text"), { target: { value: "salary" } });
    fireEvent.change(screen.getByLabelText("Document type"), { target: { value: "pay_slip" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("pay.pdf")).toBeInTheDocument();
    expect(f.mock.calls[0]![0]).toContain("q=salary");
    expect(f.mock.calls[0]![0]).toContain("docType=pay_slip");
    expect(screen.getByText(/XXXX XXXX 1234/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("123456789012");
    expect(screen.getByText(/91% · High/)).toBeInTheDocument();
    expect(screen.getByText(/HR employee file · EMP-1/)).toBeInTheDocument();
  });

  it("no results, error and downloads are each distinct", async () => {
    f.mockResolvedValueOnce(jsonResponse(200, { data: [], pagination: {} }));
    renderIntl(<SearchView docTypes={[]} />);
    fireEvent.change(screen.getByLabelText("Search text"), { target: { value: "nothing" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText("No documents found")).toBeInTheDocument();
    f.mockResolvedValueOnce(jsonResponse(500, {}));
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("because of a problem on our side");
    expect(screen.queryByText("No documents found")).not.toBeInTheDocument();
  });

  it("a failed search shows the app-standard copy plus the support reference, never the status or backend text", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    f.mockResolvedValueOnce({ ok: false, status: 500, headers: new Headers({ "x-correlation-id": "corr-ABC-123" }), json: async () => ({ code: "BOOM", message: "db exploded" }) });
    renderIntl(<SearchView docTypes={[]} />);
    fireEvent.change(screen.getByLabelText("Search text"), { target: { value: "pay" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("because of a problem on our side");
    expect(alert).toHaveTextContent("Reference: corr-ABC-123");
    expect(alert).not.toHaveTextContent(/500|BOOM|db exploded/);
    vi.unstubAllGlobals();
  });

  it("downloads go through the audited document-service endpoint; 403 and 404 differ", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    f.mockResolvedValueOnce(jsonResponse(200, { data: [hit], pagination: {} }));
    renderIntl(<SearchView docTypes={docTypes} />);
    fireEvent.change(screen.getByLabelText("Search text"), { target: { value: "salary" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const btn = await screen.findByRole("button", { name: "Download pay.pdf" });
    f.mockResolvedValueOnce(jsonResponse(200, { data: { downloadUrl: "https://s3.example/x?sig=1" } }));
    fireEvent.click(btn);
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://s3.example/x?sig=1", "_blank", "noopener,noreferrer"));
    expect(f.mock.calls[1]![0]).toBe("/api/proxy/v1/documents/bulk-scan/files/d1/download?variant=original");
    f.mockResolvedValueOnce(jsonResponse(403, {}));
    fireEvent.click(btn);
    expect(await screen.findByRole("alert")).toHaveTextContent("You do not have permission to download this document.");
    f.mockResolvedValueOnce(jsonResponse(404, {}));
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("This document was not found."));
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("403 CLEARANCE_DENIED and 503 CLEARANCE_UNAVAILABLE have distinct messages; only the 503 offers a retry that then succeeds", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    f.mockResolvedValueOnce(jsonResponse(200, { data: [hit], pagination: {} }));
    renderIntl(<SearchView docTypes={docTypes} />);
    fireEvent.change(screen.getByLabelText("Search text"), { target: { value: "salary" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const btn = await screen.findByRole("button", { name: "Download pay.pdf" });
    f.mockResolvedValueOnce(jsonResponse(403, { code: "CLEARANCE_DENIED" }));
    fireEvent.click(btn);
    expect(await screen.findByRole("alert")).toHaveTextContent("above your clearance level");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    f.mockResolvedValueOnce(jsonResponse(503, { code: "CLEARANCE_UNAVAILABLE" }));
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("clearance check is temporarily unavailable"));
    f.mockResolvedValueOnce(jsonResponse(200, { data: { downloadUrl: "https://s3.example/y?sig=2" } }));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://s3.example/y?sig=2", "_blank", "noopener,noreferrer"));
  });
});
