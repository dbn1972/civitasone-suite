import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { BatchesPanel } from "./BatchesPanel";
import type { PfmsBatchRow } from "./types";

const rows: PfmsBatchRow[] = [
  {
    id: "b1", pfmsId: "PFMS-0001", type: "salary", amountMinor: "150000000",
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
    render(<BatchesPanel batches={rows} />);
    expect(screen.getByText("PFMS-0001")).toBeInTheDocument();
  });

  it("renders an empty state when there are no batches", () => {
    render(<BatchesPanel batches={[]} />);
    expect(screen.getByText("No PFMS batches yet")).toBeInTheDocument();
  });

  it("has distinct accessible names for the sign and bank-file actions on a row", () => {
    render(<BatchesPanel batches={rows} />);
    expect(screen.getByRole("button", { name: "Sign PFMS batch PFMS-0001" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download bank file for PFMS batch PFMS-0001" })).toBeInTheDocument();
  });

  it("signs a batch on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "b1", signatureRef: "DSC:abc:def", submissionStatus: "signed" }), { status: 200 }),
    );

    render(<BatchesPanel batches={rows} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign PFMS batch PFMS-0001" }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Certificate reference/), { target: { value: "CERT-1" } });
    fireEvent.change(within(dialog).getByLabelText(/Signature payload/), { target: { value: "payload-bytes" } });
    fireEvent.click(within(dialog).getByText("Sign batch"));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("surfaces a field-specific validation error and focuses the empty cert field when signing without required fields", async () => {
    render(<BatchesPanel batches={rows} />);
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

    render(<BatchesPanel batches={rows} />);
    fireEvent.click(screen.getByRole("button", { name: "Download bank file for PFMS batch PFMS-0001" }));

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByText("Download"));

    await waitFor(() => {
      expect(within(dialog).getByText(/API_ERROR: 400/)).toBeInTheDocument();
    });
  });
});
