import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const params = { value: "" as string };
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(params.value),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import DigiLockerCallbackPage from "./page";

function wrap() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <DigiLockerCallbackPage />
    </NextIntlClientProvider>,
  );
}

/** Standard 202 accepted envelope with the callback result in `data`. */
function accepted(data: { verified: boolean; providerStatus: string }) {
  return new Response(
    JSON.stringify({ id: "d1", status: "accepted", correlationId: "c1", data: { id: "d1", ...data } }),
    { status: 202, headers: { "content-type": "application/json" } },
  );
}

describe("DigiLockerCallbackPage (GAP-CITIZEN-DOCUMENTS-02)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    params.value = "";
  });

  it("POSTs code+state and shows the source-verified result on success", async () => {
    params.value = "code=abc&state=s1";
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(accepted({ verified: true, providerStatus: "fetched" })));
    vi.stubGlobal("fetch", fetchMock);
    wrap();
    await waitFor(() => expect(screen.getByText("Document fetched and source-verified from DigiLocker.")).toBeInTheDocument());
    const call = fetchMock.mock.calls[0];
    expect(String(call[0])).toContain("/v1/citizen/documents/digilocker/callback");
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body).toMatchObject({ code: "abc", state: "s1" });
  });

  it("shows the unverified result when the API does not report source_verified", async () => {
    params.value = "code=abc&state=s1";
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(accepted({ verified: false, providerStatus: "artefact_absent" }))));
    wrap();
    await waitFor(() =>
      expect(
        screen.getByText("Document received from DigiLocker, but it could not be source-verified. An officer will review it."),
      ).toBeInTheDocument(),
    );
    // Must NOT claim verified.
    expect(screen.queryByText("Document fetched and source-verified from DigiLocker.")).not.toBeInTheDocument();
  });

  it("shows an honest error when the callback request fails", async () => {
    params.value = "code=abc&state=s1";
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(JSON.stringify({ code: "STATE_EXPIRED", message: "expired" }), { status: 410, headers: { "content-type": "application/json" } }))),
    );
    wrap();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText("Document fetched and source-verified from DigiLocker.")).not.toBeInTheDocument();
  });

  it("shows a missing-parameters error and never calls the API when code/state are absent", async () => {
    params.value = "";
    const fetchMock = vi.fn(() => Promise.resolve(accepted({ verified: true, providerStatus: "fetched" })));
    vi.stubGlobal("fetch", fetchMock);
    wrap();
    await waitFor(() =>
      expect(
        screen.getByText("This callback is missing its authorization details. Start the DigiLocker fetch again from the documents page."),
      ).toBeInTheDocument(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("links back to the documents page", async () => {
    params.value = "code=abc&state=s1";
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(accepted({ verified: true, providerStatus: "fetched" }))));
    wrap();
    await waitFor(() => expect(screen.getByText("Back to documents")).toBeInTheDocument());
    expect(screen.getByRole("link")).toHaveAttribute("href", "/citizen/documents");
  });
});
