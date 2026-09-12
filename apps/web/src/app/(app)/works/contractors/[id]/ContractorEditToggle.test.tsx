import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ContractorEditToggle } from "./ContractorEditToggle";

/**
 * Regression test — same bug class already fixed in
 * crm/contacts/[id]/edit/EditContactForm.test.tsx ("sends explicit null
 * when a previously-set field is cleared"): ContractorEditToggle used to
 * build its PATCH body with `value || undefined` for every optional field,
 * so clearing a field to "" silently became `undefined`, which
 * JSON.stringify drops from the request body — the backend never saw the
 * clear, nothing changed, yet the form still showed "Contractor updated."
 * Unlike the CRM case, works-service's updateContractorSchema fields are
 * plain `z.string().max(N).optional()` (not `.nullable()`), so the correct
 * "clear" signal here is an explicit empty string, not null.
 */

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({ data: {} }) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const contractor = {
  id: "c1",
  name: "Test Contractor",
  registrationNo: "REG-123",
  pan: "ABCDE1234F",
  gst: "22AAAAA0000A1Z5",
  email: "old@example.com",
  phone: "9876543210",
  address: "Old Address",
};

function openEditForm() {
  render(<ContractorEditToggle contractor={contractor} roles={["works_admin"]} />);
  fireEvent.click(screen.getByRole("button", { name: /edit/i }));
}

describe("ContractorEditToggle — clearing a field actually sends the clear", () => {
  it("sends an explicit empty string for a field the user clears (was: silently omitted)", async () => {
    openEditForm();
    fireEvent.change(screen.getByLabelText(/Registration No\./), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body).toHaveProperty("registrationNo", ""); // was: key absent entirely
  });

  it("leaves untouched fields out of the patch, and sends changed fields verbatim", async () => {
    openEditForm();
    fireEvent.change(screen.getByLabelText(/Phone/), { target: { value: "9000000000" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/works/contractors/c1");
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ phone: "9000000000" });
  });

  // UX-016: this used to show the backend's raw top-level `message` verbatim
  // ("invalid request") — the same class of leak useFormError closes
  // fleet-wide (UX-003). It must now report failure honestly (no false
  // success) with a clerk-safe catalogued message, never the raw text.
  it("shows a clerk-safe error instead of a false success when a clear is actually invalid (e.g. PAN)", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "invalid request" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    openEditForm();
    fireEvent.change(screen.getByLabelText(/^PAN$/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/couldn't save/i));
    expect(screen.getByRole("alert").textContent).not.toMatch(/invalid request/);
    expect(screen.queryByText("Contractor updated.")).not.toBeInTheDocument();
  });

  it("renders an inline field-level message from a fieldErrors response next to the offending field", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "VALIDATION_FAILED",
          message: "validation_failed",
          fieldErrors: [{ field: "pan", message: "PAN must be exactly 10 characters." }],
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    openEditForm();
    fireEvent.change(screen.getByLabelText(/^PAN$/), { target: { value: "SHORT" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText("PAN must be exactly 10 characters.")).toBeInTheDocument();
  });

  it("never surfaces a raw HTTP status code or raw server text on a plain-text failure", async () => {
    fetchMock.mockResolvedValue(
      new Response("Internal Server Error\n at Object.<anonymous> (/srv/works.js:20:4)", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    );
    openEditForm();
    fireEvent.change(screen.getByLabelText(/Phone/), { target: { value: "9000000000" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/\b500\b/);
    expect(alert.textContent).not.toMatch(/Internal Server Error/);
    expect(alert.textContent).not.toMatch(/at Object\.<anonymous>/);
  });
});
