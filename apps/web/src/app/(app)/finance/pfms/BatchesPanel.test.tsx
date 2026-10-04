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

  it("signs a batch on confirm with NO pasted signature fields (the DSC signer produces it server-side)", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "b1", status: "accepted", correlationId: "c1" }), { status: 202 }),
    );

    renderPanel({ batches: rows });
    fireEvent.click(screen.getByRole("button", { name: "Sign PFMS batch PFMS-0001" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).queryByLabelText(/Certificate reference/)).toBeNull();
    expect(within(dialog).queryByLabelText(/Signature payload/)).toBeNull();
    fireEvent.click(within(dialog).getByText("Sign batch"));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = spy.mock.calls[0]!;
    expect(String(url)).toContain("v1/finance/pfms/b1/sign");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({});
  });

  it("shows the signing status and certificate info, and labels a mock signature as not legally valid", () => {
    renderPanel({
      batches: [
        { ...rows[0]!, id: "b2", pfmsId: "PFMS-0002", submissionStatus: "signed", signedAt: "2026-10-01T05:00:00Z",
          signing: { status: "signed", mock: true, certificateSerial: "MOCK-1A2B", signedByName: "A. Officer", algorithm: "MOCK-SHA256withRSA", environment: "sandbox", signedAt: "2026-10-01T05:00:00Z", verifiedAt: null } },
      ],
    });
    expect(screen.getByText("Sandbox test signature, not legally valid")).toBeInTheDocument();
    expect(screen.getByText("Certificate MOCK-1A2B")).toBeInTheDocument();
    expect(screen.getByText("Signed by A. Officer")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign PFMS batch PFMS-0002" })).toBeNull();
  });

  const signedRow: PfmsBatchRow = {
    ...rows[0]!, id: "b3", pfmsId: "PFMS-0003", submissionStatus: "signed", signedAt: "2026-10-01T05:00:00Z",
    signing: { status: "signed", mock: false, certificateSerial: "SER-9", signedByName: "A. Officer", algorithm: "RSA", environment: "production", signedAt: "2026-10-01T05:00:00Z", verifiedAt: null },
  };

  it("offers Release to PFMS on a signed batch and posts to the release route", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "b3", status: "accepted" }), { status: 202 }));
    renderPanel({ batches: [signedRow] });
    expect(screen.queryByRole("button", { name: "Sign PFMS batch PFMS-0003" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Release PFMS batch PFMS-0003 to PFMS" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByText("Release batch"));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(String(spy.mock.calls[0]![0])).toContain("v1/finance/pfms/batches/b3/release");
    expect((spy.mock.calls[0]![1] as RequestInit).method).toBe("POST");
  });

  it("shows the specific message for a refusal code (maker-checker)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "MAKER_CHECKER_VIOLATION", message: "x" }), { status: 403 }));
    renderPanel({ batches: [signedRow] });
    fireEvent.click(screen.getByRole("button", { name: "Release PFMS batch PFMS-0003 to PFMS" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByText("Release batch"));
    expect(await within(dialog).findByText(/You initiated this batch, so you cannot release it/)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("hides Release for a session without a release role, and for a batch already sent", () => {
    const { unmount } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}><BatchesPanel batches={[signedRow]} canRelease={false} /></NextIntlClientProvider>,
    );
    expect(screen.queryByRole("button", { name: "Release PFMS batch PFMS-0003 to PFMS" })).toBeNull();
    unmount();
    renderPanel({ batches: [{ ...signedRow, submissionStatus: "file_sent" }] });
    expect(screen.queryByRole("button", { name: "Release PFMS batch PFMS-0003 to PFMS" })).toBeNull();
  });

  it("an unsigned pending batch shows 'Not signed' and offers Sign", () => {
    renderPanel({ batches: rows });
    expect(screen.getByText("Not signed")).toBeInTheDocument();
  });

  it("surfaces a server error when the bank-file download fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 400 }));

    renderPanel({ batches: rows });
    fireEvent.click(screen.getByRole("button", { name: "Download bank file for PFMS batch PFMS-0001" }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason for download/), { target: { value: "Upload to bank SFTP" } });
    fireEvent.click(within(dialog).getByText("Download"));

    await waitFor(() => {
      expect(within(dialog).getByText(/couldn't save/i)).toBeInTheDocument();
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
