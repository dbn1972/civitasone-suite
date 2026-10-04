import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { BatchesPanel } from "./BatchesPanel";
import type { PfmsBatchRow } from "./types";

// UX-017: BatchesPanel (and the SignBatchAction/BankFileAction it renders)
// now read their copy through next-intl (useTranslations), so they need a
// real provider in the tree -- same pattern as hr/leave/apply/ApplyLeaveForm.test.tsx.
function renderPanel(props: { batches: PfmsBatchRow[] }) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <BatchesPanel {...props} />
    </NextIntlClientProvider>,
  );
}

const rows: PfmsBatchRow[] = [
  {
    id: "b1", pfmsId: "PFMS-0001", type: "salary", channel: "treasury_batch", amountMinor: "150000000",
    agencyCode: "AG01", schemeCode: "SCH01", ddoCode: "DDO01",
    submissionStatus: "pending", signedAt: null,
  },
];

describe("BatchesPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("renders batch rows", () => {
    renderPanel({ batches: rows });
    expect(screen.getByText("PFMS-0001")).toBeInTheDocument();
  });

  it("renders an empty state when there are no batches", () => {
    renderPanel({ batches: [] });
    expect(screen.getByText("No PFMS batches yet")).toBeInTheDocument();
  });

  it("has distinct accessible names for the sign and bank-file actions on a row", () => {
    renderPanel({ batches: rows });
    expect(screen.getByRole("button", { name: "Sign PFMS batch PFMS-0001" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download bank file for PFMS batch PFMS-0001" })).toBeInTheDocument();
  });

  it("signs a batch on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "b1", signatureRef: "DSC:abc:def", submissionStatus: "signed" }), { status: 200 }),
    );

    renderPanel({ batches: rows });
    fireEvent.click(screen.getByRole("button", { name: "Sign PFMS batch PFMS-0001" }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Certificate reference/), { target: { value: "CERT-1" } });
    fireEvent.change(within(dialog).getByLabelText(/Signature payload/), { target: { value: "payload-bytes" } });
    fireEvent.click(within(dialog).getByText("Sign batch"));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("surfaces a field-specific validation error and focuses the empty cert field when signing without required fields", async () => {
    renderPanel({ batches: rows });
    fireEvent.click(screen.getByRole("button", { name: "Sign PFMS batch PFMS-0001" }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByText("Sign batch"));

    const certInput = within(dialog).getByLabelText(/Certificate reference/);
    const payloadInput = within(dialog).getByLabelText(/Signature payload/);
    await waitFor(() => {
      expect(certInput).toHaveAttribute("aria-invalid", "true");
      // Focus goes to the first invalid field.
      expect(certInput).toHaveFocus();
    });
    // Each empty field gets its own field-specific message (not one generic string).
    expect(within(dialog).getAllByText("Certificate reference is required.").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("Signature payload is required.")).toBeInTheDocument();
    expect(payloadInput).toHaveAttribute("aria-invalid", "true");
  });

  it("surfaces a server error when the bank-file download fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 400 }));

    renderPanel({ batches: rows });
    fireEvent.click(screen.getByRole("button", { name: "Download bank file for PFMS batch PFMS-0001" }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason for download/), { target: { value: "Upload to bank SFTP" } });
    fireEvent.click(within(dialog).getByText("Download"));

    await waitFor(() => {
      expect(within(dialog).getByText(/Some details weren't accepted\. Check what you entered and try again\./)).toBeInTheDocument();
    });
    expect(within(dialog).queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });

  // GAP-FINANCE-PFMS-03
  it("requires a reason before downloading the bank file: Download stays disabled and nothing is fetched", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    renderPanel({ batches: rows });
    fireEvent.click(screen.getByRole("button", { name: "Download bank file for PFMS batch PFMS-0001" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Download").closest("button")).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the stated reason to the bank-file endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("a,b", { status: 200 }));
    // jsdom has no object-URL support
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
    renderPanel({ batches: rows });
    fireEvent.click(screen.getByRole("button", { name: "Download bank file for PFMS batch PFMS-0001" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason for download/), { target: { value: "Upload to bank SFTP" } });
    fireEvent.click(within(dialog).getByText("Download"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/v1/finance/pfms/b1/bank-file?reason=Upload%20to%20bank%20SFTP");
  });
});
