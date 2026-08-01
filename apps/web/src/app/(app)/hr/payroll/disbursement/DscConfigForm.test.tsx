import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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

function selectP12File() {
  const fileInput = screen.getByLabelText(/P12 Keystore File/) as HTMLInputElement;
  const file = new File(["dummy-p12-bytes"], "cert.p12", { type: "application/x-pkcs12" });
  fireEvent.change(fileInput, { target: { files: [file] } });
}

describe("DscConfigForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a file and passphrase before opening the confirm dialog", () => {
    render(<DscConfigForm initial={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Upload Certificate" }));
    expect(screen.getByText("Select a P12 file and enter its passphrase.")).toBeInTheDocument();
  });

  it("uploads a certificate on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { ...existing, subjectCn: "CN=New Tenant" } }), { status: 200 }),
    );

    render(<DscConfigForm initial={null} />);
    selectP12File();
    fireEvent.change(screen.getByLabelText(/Passphrase/), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: "Upload Certificate" }));

    await waitFor(() => expect(screen.getByText("Upload this DSC certificate?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Upload certificate"));

    await waitFor(() => {
      expect(screen.getByText(/DSC certificate uploaded for CN=New Tenant/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the upload confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 400 }));

    render(<DscConfigForm initial={null} />);
    selectP12File();
    fireEvent.change(screen.getByLabelText(/Passphrase/), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: "Upload Certificate" }));

    await waitFor(() => expect(screen.getByText("Upload this DSC certificate?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Upload certificate"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 400/)).toBeInTheDocument();
    });
  });

  it("removes the certificate on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));

    render(<DscConfigForm initial={existing} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Certificate" }));

    await waitFor(() => expect(screen.getByText("Remove the DSC configuration?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Remove certificate"));

    await waitFor(() => {
      expect(screen.getByText("DSC configuration removed. This tenant now runs in unsigned mode.")).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the delete confirm dialog, separate from the upload error (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<DscConfigForm initial={existing} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Certificate" }));

    await waitFor(() => expect(screen.getByText("Remove the DSC configuration?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Remove certificate"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
    // The upload form's shared error paragraph must NOT also show the delete error.
    expect(screen.queryByText("Select a P12 file and enter its passphrase.")).not.toBeInTheDocument();
  });
});
