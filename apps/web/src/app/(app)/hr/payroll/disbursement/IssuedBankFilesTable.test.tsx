import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { IssuedBankFilesTable } from "./IssuedBankFilesTable";
import type { IssuedFile } from "./signingState";

const FILE: IssuedFile = {
  id: "f1", runNo: "RUN/2026/07", month: "2026-07", seq: 1, fileFormat: "csv", fileName: "bank_transfer_X.csv", lineCount: 12,
  createdAt: "2026-08-01T10:00:00Z", signatureFormat: "pgp_detached", signed: true, hasDetachedSignature: true,
  fileSha256: "ab".repeat(32), encryptedToBank: false,
};

function renderTable(files: IssuedFile[]) {
  render(<NextIntlClientProvider locale="en" messages={enMessages}><IssuedBankFilesTable files={files} /></NextIntlClientProvider>);
}

describe("IssuedBankFilesTable", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("badges each file from the server's own state: Signed (PGP), Signed (PKCS#7), Signed (XML-DSig), Unsigned (dev only)", () => {
    renderTable([
      FILE,
      { ...FILE, id: "f2", signatureFormat: "pkcs7_detached" },
      { ...FILE, id: "f3", signatureFormat: "xml_dsig", hasDetachedSignature: false },
      { ...FILE, id: "f4", signatureFormat: "none", signed: false, hasDetachedSignature: false },
    ]);
    for (const label of ["Signed (PGP)", "Signed (PKCS#7)", "Signed (XML-DSig)", "Unsigned (dev only)"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByRole("button", { name: /Download the signature of/ })).toHaveLength(2);
  });

  it("shows a short sha256 and the encrypted note", () => {
    renderTable([{ ...FILE, encryptedToBank: true }]);
    expect(screen.getByText("abababababab…")).toBeInTheDocument();
    expect(screen.getByText("Encrypted to the bank's key")).toBeInTheDocument();
  });

  it("downloads the signature for the right issuance id", async () => {
    fetchMock.mockResolvedValue(new Response("-----BEGIN PGP SIGNATURE-----", {
      status: 200, headers: { "content-type": "application/pgp-signature", "content-disposition": 'attachment; filename="bank_transfer_X.csv.sig"' },
    }));
    renderTable([FILE]);
    fireEvent.click(screen.getByRole("button", { name: /Download the signature of bank_transfer_X.csv/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0]![0])).toBe("/api/proxy/v1/payroll/disbursement/files/f1/signature");
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
  });

  it("a failed signature download shows a clerk-safe error", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "NO_DETACHED_SIGNATURE" }), { status: 404, headers: { "content-type": "application/json" } }));
    renderTable([FILE]);
    fireEvent.click(screen.getByRole("button", { name: /Download the signature of/ }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/NO_DETACHED_SIGNATURE|404/);
  });
});
