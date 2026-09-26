import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DocumentUploadCard, type OnboardingDocument } from "./DocumentUploadCard";

const REQUIRED_DOC: OnboardingDocument = {
  id: "pan",
  name: "PAN Card",
  required: true,
  status: "pending",
};

const OPTIONAL_DOC: OnboardingDocument = {
  id: "photo",
  name: "Passport Photo",
  required: false,
  status: "pending",
};

function mockUploadSuccess() {
  global.fetch = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ uploadUrl: "https://upload.example/x", key: "k1", headers: {} }),
    } as Response)
    .mockResolvedValueOnce({ ok: true } as Response);
}

function mockPresignFailure() {
  global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 500 } as Response);
}

describe("DocumentUploadCard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("required vs optional indicator", () => {
    it("marks a required document with a visible (Required) label, aria-required input, and a required-aware accessible name", () => {
      render(<DocumentUploadCard documents={[REQUIRED_DOC]} />);
      expect(screen.getByText("(Required)")).toBeInTheDocument();
      expect(screen.getByLabelText("Choose file for PAN Card (required)")).toHaveAttribute(
        "aria-required",
        "true",
      );
      expect(screen.getByRole("button", { name: "Upload PAN Card (required)" })).toBeInTheDocument();
    });

    it("marks an optional document with a visible (Optional) label and no aria-required", () => {
      render(<DocumentUploadCard documents={[OPTIONAL_DOC]} />);
      expect(screen.getByText("(Optional)")).toBeInTheDocument();
      const input = screen.getByLabelText("Choose file for Passport Photo");
      expect(input).not.toHaveAttribute("aria-required");
      expect(screen.getByRole("button", { name: "Upload Passport Photo" })).toBeInTheDocument();
    });
  });

  describe("upload result announcements", () => {
    it("announces a successful upload via role=status, reusing the same mechanism as the failure path", async () => {
      mockUploadSuccess();
      render(<DocumentUploadCard documents={[REQUIRED_DOC]} />);
      const input = screen.getByLabelText("Choose file for PAN Card (required)");
      const file = new File(["dummy"], "pan.pdf", { type: "application/pdf" });

      fireEvent.change(input, { target: { files: [file] } });

      const status = await screen.findByRole("status");
      expect(status).toHaveTextContent("pan.pdf uploaded successfully.");
      // The failure path's role=alert node must not also be present.
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("still announces a failed upload via role=alert (regression -- this is the pre-existing mechanism the success path now mirrors)", async () => {
      mockPresignFailure();
      render(<DocumentUploadCard documents={[REQUIRED_DOC]} />);
      const input = screen.getByLabelText("Choose file for PAN Card (required)");
      const file = new File(["dummy"], "pan.pdf", { type: "application/pdf" });

      fireEvent.change(input, { target: { files: [file] } });

      // Clerk-safe copy via useFormError (UX-003/UX-016), same convention as
      // ds/FileUpload.test.tsx's "never the raw response text" check -- never
      // the raw HTTP status code this used to interpolate directly.
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/couldn't save/i);
      expect(alert).not.toHaveTextContent(/500/);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("clears a prior success message once a later attempt fails, so the two don't show at once", async () => {
      mockUploadSuccess();
      render(<DocumentUploadCard documents={[REQUIRED_DOC]} />);
      const input = screen.getByLabelText("Choose file for PAN Card (required)");
      const file = new File(["dummy"], "pan.pdf", { type: "application/pdf" });

      fireEvent.change(input, { target: { files: [file] } });
      await screen.findByRole("status");

      mockPresignFailure();
      fireEvent.change(input, { target: { files: [file] } });

      await screen.findByRole("alert");
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });
});
