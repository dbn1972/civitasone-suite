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

    // GAP-HR-ONBOARDING-DETAIL-03 regression: an oversize file used to call
    // window.alert(), a blocking modal with no accessible role and no
    // useFormError-mediated copy -- now a plain inline role=alert message,
    // consistent with every other failure in this component.
    it("GAP-HR-ONBOARDING-DETAIL-03: shows an inline alert for an oversize file instead of a browser alert()", () => {
      const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
      render(<DocumentUploadCard documents={[REQUIRED_DOC]} />);
      const input = screen.getByLabelText("Choose file for PAN Card (required)");
      const bigFile = new File([new Uint8Array(11 * 1024 * 1024)], "big.pdf", { type: "application/pdf" });

      fireEvent.change(input, { target: { files: [bigFile] } });

      expect(screen.getByRole("alert")).toHaveTextContent(/too large/i);
      expect(alertSpy).not.toHaveBeenCalled();
    });
  });

  describe("DPDP notice", () => {
    it("GAP-HR-ONBOARDING-DETAIL-03: shows a purpose/visibility notice above the upload list", () => {
      render(<DocumentUploadCard documents={[REQUIRED_DOC]} />);
      expect(screen.getByRole("note")).toHaveTextContent(/visible only to hr/i);
    });

    it("uses the caller's i18n-sourced notice text when provided", () => {
      render(<DocumentUploadCard documents={[REQUIRED_DOC]} dpdpNotice="Custom compliance copy for this tenant." />);
      expect(screen.getByRole("note")).toHaveTextContent("Custom compliance copy for this tenant.");
    });
  });

  describe("view/verify/reject actions (GAP-HR-ONBOARDING-DETAIL-02)", () => {
    const UPLOADED_DOC: OnboardingDocument = {
      id: "pan",
      name: "PAN Card",
      required: true,
      status: "uploaded",
      uploadedFileName: "pan.pdf",
      storageKey: "uploads/t1/document/abc.pdf",
    };

    it("offers a View action once a document has a storage key, and opens the presigned download URL", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ downloadUrl: "https://cdn.example/signed" }),
      } as Response);
      const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

      render(<DocumentUploadCard documents={[UPLOADED_DOC]} />);
      fireEvent.click(screen.getByRole("button", { name: "View" }));

      await vi.waitFor(() => expect(openSpy).toHaveBeenCalledWith("https://cdn.example/signed", "_blank", "noopener,noreferrer"));
      expect(global.fetch).toHaveBeenCalledWith("/api/proxy/v1/admin/uploads/uploads%2Ft1%2Fdocument%2Fabc.pdf");
    });

    it("does not offer a View action before anything has been uploaded (no storage key yet)", () => {
      render(<DocumentUploadCard documents={[REQUIRED_DOC]} />);
      expect(screen.queryByRole("button", { name: "View" })).not.toBeInTheDocument();
    });

    it("offers Verify/Reject once a document is uploaded, and calls back with its id", () => {
      const onVerify = vi.fn();
      const onReject = vi.fn();
      render(<DocumentUploadCard documents={[UPLOADED_DOC]} onVerify={onVerify} onReject={onReject} />);

      fireEvent.click(screen.getByRole("button", { name: "Verify" }));
      expect(onVerify).toHaveBeenCalledWith("pan");

      fireEvent.click(screen.getByRole("button", { name: "Reject" }));
      expect(onReject).toHaveBeenCalledWith("pan");
    });

    it("does not offer Verify/Reject for a document that is still pending", () => {
      render(<DocumentUploadCard documents={[REQUIRED_DOC]} onVerify={vi.fn()} onReject={vi.fn()} />);
      expect(screen.queryByRole("button", { name: "Verify" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    });
  });
});
