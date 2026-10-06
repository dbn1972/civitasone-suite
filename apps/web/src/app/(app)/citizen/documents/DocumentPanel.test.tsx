import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { DocumentPanel, type DocumentServiceOption } from "./DocumentPanel";

const SERVICES: DocumentServiceOption[] = [
  { id: "svc-1", name: "Birth Certificate", serviceKey: "birth-cert" },
  { id: "svc-2", name: "Water Connection", serviceKey: "water" },
];

function renderPanel(configured: boolean) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("digilocker-status")) {
      return Promise.resolve(new Response(JSON.stringify({ configured }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (url.includes("/checklist")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ source: "service_defaults", complete: false, items: [{ docType: "id_proof", label: "Identity proof", mandatory: true, provided: false, verified: false }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }
    return Promise.resolve(new Response(JSON.stringify({ id: "d1", verificationStatus: "pending" }), { status: 200, headers: { "content-type": "application/json" } }));
  });
  vi.stubGlobal("fetch", fetchMock);
  const utils = render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <DocumentPanel services={SERVICES} />
    </NextIntlClientProvider>,
  );
  return { ...utils, fetchMock };
}

describe("DocumentPanel", () => {
  beforeEach(() => vi.unstubAllGlobals());

  // GAP-CITIZEN-DOCUMENTS-03
  it("offers services by name (no hand-typed Service UUID input)", () => {
    renderPanel(true);
    const select = screen.getByLabelText("Service") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    expect(screen.getByRole("option", { name: "Birth Certificate" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Water Connection" })).toBeInTheDocument();
    // The old free-text Service ID (UUID) label must be gone.
    expect(screen.queryByText("Service ID (UUID)")).not.toBeInTheDocument();
  });

  // GAP-CITIZEN-DOCUMENTS-04
  it("populates docType from the loaded checklist as a select, not free text", async () => {
    renderPanel(true);
    fireEvent.change(screen.getByLabelText("Service"), { target: { value: "svc-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Load checklist" }));
    await waitFor(() => expect(screen.getByRole("option", { name: "Identity proof" })).toBeInTheDocument());
    const docSelect = screen.getByLabelText("Document type") as HTMLSelectElement;
    expect(docSelect.tagName).toBe("SELECT");
  });

  // GAP-CITIZEN-DOCUMENTS-02 — consent gating + unconfigured disable
  it("disables Fetch from DigiLocker when the provider is not configured", async () => {
    renderPanel(false);
    await waitFor(() => expect(screen.getByText("DigiLocker is not configured for this tenant.")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Fetch from DigiLocker" })).toBeDisabled();
  });

  it("keeps DigiLocker disabled until the DPDP consent box is ticked (even when configured and a service+docType are set)", async () => {
    renderPanel(true);
    fireEvent.change(screen.getByLabelText("Service"), { target: { value: "svc-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Load checklist" }));
    await waitFor(() => expect(screen.getByRole("option", { name: "Identity proof" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Document type"), { target: { value: "id_proof" } });
    const digiBtn = screen.getByRole("button", { name: "Fetch from DigiLocker" });
    expect(digiBtn).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(digiBtn).not.toBeDisabled());
  });

  // GAP-CITIZEN-DOCUMENTS-06 — humanized status, no raw code in result
  it("humanizes the verification status in the result panel (no raw 'pending' code)", async () => {
    renderPanel(true);
    fireEvent.change(screen.getByLabelText("Service"), { target: { value: "svc-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Load checklist" }));
    await waitFor(() => expect(screen.getByRole("option", { name: "Identity proof" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Document type"), { target: { value: "id_proof" } });
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(screen.getByText(/Submitted — verification: Pending\./)).toBeInTheDocument());
  });
});
