/**
 * F2 — ServerExportButton drives the SERVER-AUDITED export: it collects a
 * purpose (min 10), forwards it + the active filters to the server endpoint,
 * and downloads whatever CSV the server returns. Unlike the old DataTable Blob,
 * the server is the authority (filters, PII masking, audit).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";

const browserFetchMock = vi.fn();
vi.mock("@/lib/api/browserClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/browserClient")>("@/lib/api/browserClient");
  return { ...actual, browserFetch: (...args: unknown[]) => browserFetchMock(...args) };
});

import { ServerExportButton } from "./ServerExportButton";

function makeRes(ok: boolean, status: number, text: string): Response {
  return { ok, status, text: async () => text, json: async () => ({}) } as unknown as Response;
}

describe("ServerExportButton", () => {
  beforeEach(() => {
    browserFetchMock.mockReset();
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:mock";
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  it("requires a purpose of at least 10 chars before the export runs", async () => {
    browserFetchMock.mockResolvedValue(makeRes(true, 200, "Reference\r\n\"SRQ/2026/A\""));
    render(
      <ServerExportButton
        endpointPath="v1/crm/service-requests/export"
        filenameBase="service-requests"
        filters={{ status: "open" }}
        kind="serviceRequests"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Export CSV/i }));
    // The Export action is disabled until a valid purpose is typed.
    const exportBtn = screen.getByRole("button", { name: /^Export$/ });
    expect(exportBtn).toBeDisabled();
    expect(browserFetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Purpose/i), { target: { value: "monthly register review" } });
    expect(screen.getByRole("button", { name: /^Export$/ })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /^Export$/ }));

    await waitFor(() => expect(browserFetchMock).toHaveBeenCalled());
    const url = browserFetchMock.mock.calls[0][0] as string;
    expect(url).toContain("v1/crm/service-requests/export?");
    expect(url).toContain("purpose=monthly+register+review");
    expect(url).toContain("status=open");
    await waitFor(() => expect(screen.getByText(/recorded in the audit trail/i)).toBeInTheDocument());
  });

  it("surfaces a server rejection (e.g. 403) as clerk-safe copy", async () => {
    browserFetchMock.mockResolvedValue(makeRes(false, 403, ""));
    render(
      <ServerExportButton
        endpointPath="v1/crm/grievances/export"
        filenameBase="grievances"
        kind="serviceRequests"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Export CSV/i }));
    fireEvent.change(screen.getByLabelText(/Purpose/i), { target: { value: "grievance register review" } });
    fireEvent.click(screen.getByRole("button", { name: /^Export$/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});
