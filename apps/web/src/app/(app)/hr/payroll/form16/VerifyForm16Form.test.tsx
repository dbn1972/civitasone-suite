import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { VerifyForm16Form } from "./VerifyForm16Form";

// UX-017: VerifyForm16Form now reads its copy through next-intl
// (useTranslations("verifyForm16Form")), so every render needs a real
// provider in the tree.
function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <VerifyForm16Form />
    </NextIntlClientProvider>,
  );
}

function makePdfFile(name = "form16.pdf", type = "application/pdf"): File {
  return new File(["%PDF-1.4 fake pdf bytes"], name, { type });
}

describe("VerifyForm16Form", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requires a file before submitting", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Verify signature" }));
    expect(screen.getByText("Choose a Form-16 PDF to verify.")).toBeInTheDocument();
  });

  it("shows the verification result on success (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { valid: true, signerCN: "CivitasOne DSC", signedAt: "2026-04-01T00:00:00.000Z", certificateExpiry: "2027-04-01T00:00:00.000Z", issues: [] },
        }),
        { status: 200 },
      ),
    );

    renderForm();
    const input = screen.getByLabelText(/Form-16 PDF/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makePdfFile()] } });
    fireEvent.click(screen.getByRole("button", { name: "Verify signature" }));

    await waitFor(() => {
      expect(screen.getByText("Signature valid")).toBeInTheDocument();
      expect(screen.getByText(/CivitasOne DSC/)).toBeInTheDocument();
    });
  });

  it("surfaces a server error (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 400 }));

    renderForm();
    const input = screen.getByLabelText(/Form-16 PDF/) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makePdfFile()] } });
    fireEvent.click(screen.getByRole("button", { name: "Verify signature" }));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });
});
