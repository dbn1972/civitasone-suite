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
  const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
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
    // GAP-CITIZEN-DOCUMENTS-01: presign → PUT to storage → record.
    if (url.includes("/documents/presign")) {
      return Promise.resolve(new Response(JSON.stringify({ uploadUrl: "https://s3.local/put", key: "citizen-documents/t/a/obj.pdf", method: "PUT", headers: {} }), { status: 200, headers: { "content-type": "application/json" } }));
    }
    if (url.startsWith("https://s3.local/put")) {
      return Promise.resolve(new Response(null, { status: 200 }));
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

function attachFile() {
  const input = screen.getByLabelText("File to upload") as HTMLInputElement;
  const file = new File(["pdf-bytes"], "aadhaar.pdf", { type: "application/pdf" });
  fireEvent.change(input, { target: { files: [file] } });
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
    attachFile();
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(screen.getByText(/Submitted — verification: Pending\./)).toBeInTheDocument());
  });

  // GAP-CITIZEN-DOCUMENTS-01 — real file upload transport
  it("Upload is disabled until a file is attached", async () => {
    renderPanel(true);
    fireEvent.change(screen.getByLabelText("Service"), { target: { value: "svc-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Load checklist" }));
    await waitFor(() => expect(screen.getByRole("option", { name: "Identity proof" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Document type"), { target: { value: "id_proof" } });
    expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();
    attachFile();
    await waitFor(() => expect(screen.getByRole("button", { name: "Upload" })).not.toBeDisabled());
  });

  it("Upload presigns, PUTs the file to storage, then records the returned object key", async () => {
    const { fetchMock } = renderPanel(true);
    fireEvent.change(screen.getByLabelText("Service"), { target: { value: "svc-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Load checklist" }));
    await waitFor(() => expect(screen.getByRole("option", { name: "Identity proof" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Document type"), { target: { value: "id_proof" } });
    attachFile();
    fireEvent.click(screen.getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(screen.getByText(/Submitted — verification: Pending\./)).toBeInTheDocument());
    const calls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("/documents/presign"))).toBe(true);
    expect(calls.some((u) => u.startsWith("https://s3.local/put"))).toBe(true);
    const uploadCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/documents/upload"));
    expect(uploadCall).toBeDefined();
    const body = JSON.parse((uploadCall![1] as RequestInit).body as string);
    expect(body.storageKey).toBe("citizen-documents/t/a/obj.pdf");
  });

  // GAP-CITIZEN-DOCUMENTS-02 — configured => POST /authorize then redirect to authorizeUrl.
  it("redirects the browser to the provider authorizeUrl when DigiLocker is configured", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { origin: "https://portal.test", assign });
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("digilocker-status")) {
        return Promise.resolve(new Response(JSON.stringify({ configured: true }), { status: 200, headers: { "content-type": "application/json" } }));
      }
      if (url.includes("/checklist")) {
        return Promise.resolve(new Response(JSON.stringify({ source: "service_defaults", complete: false, items: [{ docType: "id_proof", label: "Identity proof", mandatory: true, provided: false, verified: false }] }), { status: 200, headers: { "content-type": "application/json" } }));
      }
      if (url.includes("/digilocker/authorize")) {
        return Promise.resolve(new Response(JSON.stringify({ authorizeUrl: "https://digilocker.test/oauth/authorize?state=s1", state: "s1", expiresAt: new Date().toISOString() }), { status: 200, headers: { "content-type": "application/json" } }));
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <DocumentPanel services={SERVICES} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Service"), { target: { value: "svc-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Load checklist" }));
    await waitFor(() => expect(screen.getByRole("option", { name: "Identity proof" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Document type"), { target: { value: "id_proof" } });
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Fetch from DigiLocker" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Fetch from DigiLocker" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://digilocker.test/oauth/authorize?state=s1"));
    // The old fabricated docUri path must be gone — no digilocker-fetch POST.
    const calls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("/digilocker-fetch"))).toBe(false);
  });

  // GAP-CITIZEN-DOCUMENTS-02 — 409 PROVIDER_UNCONFIGURED keeps the honest disabled state.
  it("keeps the honest disabled state when /authorize returns 409 PROVIDER_UNCONFIGURED", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { origin: "https://portal.test", assign });
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      // Status probe initially reports configured so the button is enabled,
      // but the authorize call fails closed with a 409.
      if (url.includes("digilocker-status")) {
        return Promise.resolve(new Response(JSON.stringify({ configured: true }), { status: 200, headers: { "content-type": "application/json" } }));
      }
      if (url.includes("/checklist")) {
        return Promise.resolve(new Response(JSON.stringify({ source: "service_defaults", complete: false, items: [{ docType: "id_proof", label: "Identity proof", mandatory: true, provided: false, verified: false }] }), { status: 200, headers: { "content-type": "application/json" } }));
      }
      if (url.includes("/digilocker/authorize")) {
        return Promise.resolve(new Response(JSON.stringify({ code: "PROVIDER_UNCONFIGURED", message: "not configured" }), { status: 409, headers: { "content-type": "application/json" } }));
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <DocumentPanel services={SERVICES} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Service"), { target: { value: "svc-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Load checklist" }));
    await waitFor(() => expect(screen.getByRole("option", { name: "Identity proof" })).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Document type"), { target: { value: "id_proof" } });
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Fetch from DigiLocker" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Fetch from DigiLocker" }));
    // No redirect; the honest "not configured" copy appears and the button disables.
    await waitFor(() => expect(screen.getAllByText("DigiLocker is not configured for this tenant.").length).toBeGreaterThan(0));
    expect(assign).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Fetch from DigiLocker" })).toBeDisabled());
  });
});
