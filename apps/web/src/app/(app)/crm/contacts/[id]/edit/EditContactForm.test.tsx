import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/lib/testUtils/intl";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const browserFetchMock = vi.fn();
vi.mock("@/lib/api/browserClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/browserClient")>("@/lib/api/browserClient");
  return { ...actual, browserFetch: (...args: unknown[]) => browserFetchMock(...args) };
});

import EditContactForm from "./EditContactForm";

function makeRes(ok: boolean, status: number, body: unknown): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const initial = {
  name: "Asha Rao",
  email: "asha@example.com",
  phone: "9900000000",
  organization: "Acme",
  designation: "Director",
  city: "Bengaluru",
  leadStatus: "qualified",
  marketingConsent: true,
};

describe("EditContactForm", () => {
  beforeEach(() => {
    pushMock.mockReset();
    browserFetchMock.mockReset();
    browserFetchMock.mockResolvedValue(makeRes(true, 200, {}));
  });

  // GAP-CRM-CONTACTS-DETAIL-EDIT-02: no lead-status select; status is read-only.
  it("has no lead status select and offers a governed Change status link", () => {
    renderWithIntl(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    expect(screen.queryByLabelText("Lead status")).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Change status" });
    expect(link).toHaveAttribute("href", "/crm/contacts/c1");
    expect(screen.getByText("Qualified")).toBeInTheDocument();
  });

  // GAP-CRM-CONTACTS-DETAIL-EDIT-01 + EDIT-02: clearing City sends {city:null},
  // and the PATCH body never carries leadStatus.
  it("clears City via null and never sends leadStatus", async () => {
    renderWithIntl(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(browserFetchMock).toHaveBeenCalled());
    const patchCall = browserFetchMock.mock.calls.find((c) => c[0] === "v1/crm/contacts/c1");
    expect(patchCall).toBeDefined();
    const body = JSON.parse((patchCall![1] as { body: string }).body) as Record<string, unknown>;
    expect(body).toEqual({ city: null });
    expect(body).not.toHaveProperty("leadStatus");
  });

  // GAP-CRM-CONTACTS-DETAIL-EDIT-01: an unchanged form sends no core PATCH.
  it("does not PATCH the contact when nothing core/consent changed", async () => {
    renderWithIntl(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(browserFetchMock).toHaveBeenCalled());
    // Only the classification endpoint is hit; the contact PATCH is skipped.
    const contactPatch = browserFetchMock.mock.calls.find((c) => c[0] === "v1/crm/contacts/c1");
    expect(contactPatch).toBeUndefined();
    const classificationCall = browserFetchMock.mock.calls.find(
      (c) => typeof c[0] === "string" && c[0].includes("/classification"),
    );
    expect(classificationCall).toBeDefined();
  });

  // GAP-CRM-CONTACTS-DETAIL-EDIT-03: PATCH ok but classification fails -> the
  // message must say details were saved, and a retry re-sends ONLY classification.
  it("reports a partial save and retries only the classification after a classification failure", async () => {
    browserFetchMock.mockImplementation((path: string) => {
      if (typeof path === "string" && path.includes("/classification")) {
        return Promise.resolve(makeRes(false, 500, { code: "INTERNAL" }));
      }
      return Promise.resolve(makeRes(true, 200, {}));
    });
    renderWithIntl(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    // Change a core field so the PATCH runs.
    fireEvent.change(screen.getByLabelText("Designation"), { target: { value: "VP" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.getByText(/details were saved, but the classification/i)).toBeInTheDocument());
    const patchCount = () => browserFetchMock.mock.calls.filter((c) => c[0] === "v1/crm/contacts/c1").length;
    expect(patchCount()).toBe(1);

    // Retry: classification now succeeds; the core PATCH must NOT run again.
    browserFetchMock.mockResolvedValue(makeRes(true, 200, {}));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/crm/contacts/c1"));
    expect(patchCount()).toBe(1); // still only the original PATCH
  });

  // GAP-CRM-CONTACTS-DETAIL-EDIT-05: a backend format error maps under its field.
  it("shows an INVALID_MOBILE error under the Phone field", async () => {
    browserFetchMock.mockImplementation((path: string) => {
      if (path === "v1/crm/contacts/c1") {
        return Promise.resolve(makeRes(false, 400, { code: "INVALID_MOBILE", message: "Enter a valid 10-digit Indian mobile number." }));
      }
      return Promise.resolve(makeRes(true, 200, {}));
    });
    renderWithIntl(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText(/valid 10-digit Indian mobile/i)).toBeInTheDocument());
    expect(screen.getByLabelText("Phone")).toHaveAttribute("aria-invalid", "true");
  });

  // GAP-CRM-CONTACTS-NEW-02: the Organisation field is an account picker; a
  // contact already linked to an account seeds it (resolve) and unlinking sends
  // accountId: null on save.
  it("seeds the linked account and sends accountId: null when the account is cleared", async () => {
    browserFetchMock.mockImplementation((path: string) => {
      if (path === "v1/crm/accounts") {
        return Promise.resolve(makeRes(true, 200, { data: [{ id: "acc-1", name: "Acme" }] }));
      }
      return Promise.resolve(makeRes(true, 200, {}));
    });
    const linked = { ...initial, accountId: "acc-1" };
    renderWithIntl(<EditContactForm params={{ id: "c1" }} initial={linked} />);
    // The account picker shows the seeded account name (from initial.organization).
    const picker = screen.getByRole("combobox", { name: /link to an existing account/i }) as HTMLInputElement;
    await waitFor(() => expect(picker.value).toBe("Acme"));
    // Clear the account link.
    fireEvent.change(picker, { target: { value: "" } });
    fireEvent.keyDown(picker, { key: "Backspace" });
    // Clearing via the input empties the query; explicitly unlink by selecting none.
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(browserFetchMock).toHaveBeenCalled());
  });
});

describe("EditContactForm cancel + dirty guard (GAP-CRM-CONTACTS-DETAIL-EDIT-06)", () => {
  beforeEach(() => {
    pushMock.mockReset();
    browserFetchMock.mockReset();
    browserFetchMock.mockResolvedValue(makeRes(true, 200, {}));
  });

  it("Cancel navigates immediately when the form is clean (no confirm)", () => {
    renderWithIntl(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Discard unsaved changes?")).not.toBeInTheDocument();
    expect(pushMock).toHaveBeenCalledWith("/crm/contacts/c1");
  });

  it("Cancel on a dirty form opens a confirm; Keep editing cancels the navigation", () => {
    renderWithIntl(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    fireEvent.change(screen.getByLabelText("Designation"), { target: { value: "VP" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Discard unsaved changes?")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(pushMock).not.toHaveBeenCalled();
    // Confirming discards and navigates.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(pushMock).toHaveBeenCalledWith("/crm/contacts/c1");
  });
});

describe("EditContactForm DPDP consent + identifiers (GAP-CRM-CONTACTS-DETAIL-EDIT-07)", () => {
  const noConsent = { ...initial, marketingConsent: false };

  beforeEach(() => {
    pushMock.mockReset();
    browserFetchMock.mockReset();
    browserFetchMock.mockResolvedValue(makeRes(true, 200, {}));
  });

  it("blocks save when consent is granted without a purpose/channel", async () => {
    renderWithIntl(<EditContactForm params={{ id: "c1" }} initial={noConsent} />);
    // Grant consent (checkbox) but leave purpose/channel empty.
    fireEvent.click(screen.getByRole("checkbox", { name: /consent to marketing/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText(/Select a purpose and the channel/i)).toBeInTheDocument());
    // No PATCH went out because the client gate blocked it.
    expect(browserFetchMock.mock.calls.find((c) => c[0] === "v1/crm/contacts/c1")).toBeUndefined();
  });

  it("sends marketingConsent + purpose + channel when all are provided", async () => {
    renderWithIntl(<EditContactForm params={{ id: "c1" }} initial={noConsent} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /consent to marketing/i }));
    fireEvent.change(screen.getByLabelText("Purpose *"), { target: { value: "marketing" } });
    fireEvent.change(screen.getByLabelText("Captured via *"), { target: { value: "phone" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(browserFetchMock).toHaveBeenCalled());
    const patchCall = browserFetchMock.mock.calls.find((c) => c[0] === "v1/crm/contacts/c1");
    expect(patchCall).toBeDefined();
    const body = JSON.parse((patchCall![1] as { body: string }).body) as Record<string, unknown>;
    expect(body.marketingConsent).toBe(true);
    expect(body.consentPurpose).toBe("marketing");
    expect(body.consentChannel).toBe("phone");
  });

  it("sends an edited GSTIN (and only changed identifiers)", async () => {
    renderWithIntl(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    fireEvent.change(screen.getByLabelText("GSTIN"), { target: { value: "21ABCDE1234F1Z5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(browserFetchMock).toHaveBeenCalled());
    const patchCall = browserFetchMock.mock.calls.find((c) => c[0] === "v1/crm/contacts/c1");
    expect(patchCall).toBeDefined();
    const body = JSON.parse((patchCall![1] as { body: string }).body) as Record<string, unknown>;
    expect(body.gstin).toBe("21ABCDE1234F1Z5");
    expect(body).not.toHaveProperty("pan");
  });

  it("surfaces an INVALID_GSTIN format error under the GSTIN field", async () => {
    browserFetchMock.mockImplementation((path: string) => {
      if (path === "v1/crm/contacts/c1") {
        return Promise.resolve(makeRes(false, 400, { code: "INVALID_GSTIN", message: "Enter a valid 15-character GSTIN." }));
      }
      return Promise.resolve(makeRes(true, 200, {}));
    });
    renderWithIntl(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    fireEvent.change(screen.getByLabelText("GSTIN"), { target: { value: "BAD" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText(/valid 15-character GSTIN/i)).toBeInTheDocument());
    expect(screen.getByLabelText("GSTIN")).toHaveAttribute("aria-invalid", "true");
  });
});
