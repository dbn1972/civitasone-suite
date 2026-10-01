import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { DscConfigForm } from "./DscConfigForm";

const existing = {
  subjectCn: "CN=Test Tenant",
  serialNumber: "SN-1",
  notBefore: "2026-01-01",
  notAfter: "2027-01-01",
  sha256Fingerprint: "AA:BB:CC",
};

// UX-017: DscConfigForm now reads its copy through next-intl
// (useTranslations("dscConfigForm")), so every render needs a real provider
// in the tree -- same pattern as hr/employees/[id]/edit/EditEmployeeForm.test.tsx.
function renderForm(initial: typeof existing | null) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <DscConfigForm initial={initial} />
    </NextIntlClientProvider>,
  );
}

function selectP12File() {
  const fileInput = screen.getByLabelText(/P12 Keystore File/) as HTMLInputElement;
  const file = new File(["dummy-p12-bytes"], "cert.p12", { type: "application/x-pkcs12" });
  fireEvent.change(fileInput, { target: { files: [file] } });
}

const REASON = "Annual certificate renewal per IT cell";

function typeReason(text = REASON) {
  fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: text } });
}

describe("DscConfigForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a file and passphrase before opening the confirm dialog", () => {
    renderForm(null);
    fireEvent.click(screen.getByRole("button", { name: "Upload Certificate" }));
    expect(screen.getByText("Select a P12 file and enter its passphrase.")).toBeInTheDocument();
  });

  it("uploads a certificate on confirm with an audited reason (happy path, real 202 Accepted shape)", async () => {
    // The real API answers 202 { id, status: "accepted", correlationId } --
    // no cert metadata. The old code read res.data.subjectCn and showed an
    // error for every successful upload.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "cmd-1", status: "accepted", correlationId: "c-1" }), { status: 202 }),
    );

    renderForm(null);
    selectP12File();
    fireEvent.change(screen.getByLabelText(/Passphrase/), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: "Upload Certificate" }));

    await waitFor(() => expect(screen.getByText("Upload this DSC certificate?")).toBeInTheDocument());
    // GAP-PAYROLL-DISBURSEMENT-04: a reason of >= 10 chars is required.
    expect(screen.getByText("Upload certificate").closest("button")).toBeDisabled();
    typeReason("too short");
    expect(screen.getByText("Upload certificate").closest("button")).toBeDisabled();
    typeReason();
    fireEvent.click(screen.getByText("Upload certificate"));

    await waitFor(() => {
      expect(screen.getByText(/Certificate accepted/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(body.reason).toBe(REASON);
    expect(body.p12Base64).toBeTruthy();
    // Passphrase cleared after success.
    expect((screen.getByLabelText(/Passphrase/) as HTMLInputElement).value).toBe("");
  });

  it("clears the passphrase when the upload confirm dialog is cancelled", async () => {
    renderForm(null);
    selectP12File();
    fireEvent.change(screen.getByLabelText(/Passphrase/), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: "Upload Certificate" }));
    await waitFor(() => expect(screen.getByText("Upload this DSC certificate?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect((screen.getByLabelText(/Passphrase/) as HTMLInputElement).value).toBe("");
  });

  it("surfaces a server error on the upload confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 400 }));

    renderForm(null);
    selectP12File();
    fireEvent.change(screen.getByLabelText(/Passphrase/), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: "Upload Certificate" }));

    await waitFor(() => expect(screen.getByText("Upload this DSC certificate?")).toBeInTheDocument());
    typeReason();
    fireEvent.click(screen.getByText("Upload certificate"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });

  it("removes the certificate on confirm, sending the reason (happy path)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "cmd-2", status: "accepted", correlationId: "c-2" }), { status: 202 }),
    );

    renderForm(existing);
    fireEvent.click(screen.getByRole("button", { name: "Remove Certificate" }));

    await waitFor(() => expect(screen.getByText("Remove the DSC configuration?")).toBeInTheDocument());
    expect(screen.getByText("Remove certificate").closest("button")).toBeDisabled();
    typeReason("Officer transferred, key revoked by CA");
    fireEvent.click(screen.getByText("Remove certificate"));

    await waitFor(() => {
      expect(screen.getByText(/DSC removal accepted/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(String(init.body))).toEqual({ reason: "Officer transferred, key revoked by CA" });
  });

  it("surfaces a server error on the delete confirm dialog, separate from the upload error (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    renderForm(existing);
    fireEvent.click(screen.getByRole("button", { name: "Remove Certificate" }));

    await waitFor(() => expect(screen.getByText("Remove the DSC configuration?")).toBeInTheDocument());
    typeReason();
    fireEvent.click(screen.getByText("Remove certificate"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
    // The upload form's shared error paragraph must NOT also show the delete error.
    expect(screen.queryByText("Select a P12 file and enter its passphrase.")).not.toBeInTheDocument();
  });
});
