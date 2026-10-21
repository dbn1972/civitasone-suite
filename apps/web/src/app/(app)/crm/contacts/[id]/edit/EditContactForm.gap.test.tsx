import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

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
    render(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    expect(screen.queryByLabelText("Lead status")).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Change status" });
    expect(link).toHaveAttribute("href", "/crm/contacts/c1");
    expect(screen.getByText("Qualified")).toBeInTheDocument();
  });

  // GAP-CRM-CONTACTS-DETAIL-EDIT-01 + EDIT-02: clearing City sends {city:null},
  // and the PATCH body never carries leadStatus.
  it("clears City via null and never sends leadStatus", async () => {
    render(<EditContactForm params={{ id: "c1" }} initial={initial} />);
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
    render(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    // Nothing changed: neither the contact PATCH nor the classification PATCH is sent.
    expect(await screen.findByText("No changes to save.")).toBeInTheDocument();
    expect(browserFetchMock).not.toHaveBeenCalled();
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
    render(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    // Change a core field so the PATCH runs, and the classification so it is sent.
    fireEvent.change(screen.getByLabelText("Designation"), { target: { value: "VP" } });
    fireEvent.change(screen.getByLabelText("Temperature"), { target: { value: "hot" } });
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
    render(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.getByText(/valid 10-digit Indian mobile/i)).toBeInTheDocument());
    expect(screen.getByLabelText("Phone")).toHaveAttribute("aria-invalid", "true");
  });

  // GAP-CRM-CONTACTS-NEW-02: the Organisation field is an account picker; a
  // contact already linked to an account seeds it (resolve), and saving without
  // touching the link re-sends nothing.
  it("seeds the linked account into the picker and does not re-send the link when it is unchanged", async () => {
    browserFetchMock.mockImplementation((path: string) => {
      if (path === "v1/crm/accounts") {
        return Promise.resolve(makeRes(true, 200, { data: [{ id: "acc-1", name: "Acme" }] }));
      }
      return Promise.resolve(makeRes(true, 200, {}));
    });
    const linked = { ...initial, accountId: "acc-1" };
    render(<EditContactForm params={{ id: "c1" }} initial={linked} />);
    // The account picker shows the seeded account name (from initial.organization).
    const picker = screen.getByRole("combobox", { name: /link to an existing account/i }) as HTMLInputElement;
    await waitFor(() => expect(picker.value).toBe("Acme"));
    // Saving without touching the link sends nothing: no contact PATCH (so no
    // accountId), and the untouched classification is not re-sent either.
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("No changes to save.")).toBeInTheDocument();
    expect(browserFetchMock).not.toHaveBeenCalled();
  });

  // GAP-CRM-CONTACTS-DETAIL-EDIT-01 + GAP-CRM-CONTACTS-NEW-02: clearing the
  // Organisation on an account-linked contact unlinks it - the PATCH carries an
  // explicit accountId: null (the backend accepts null to unlink). The picker has
  // no clear control of its own, so the form offers "Unlink account".
  it("unlinks the account and sends accountId: null when the link is cleared", async () => {
    browserFetchMock.mockImplementation((path: string) => {
      if (path === "v1/crm/accounts") {
        return Promise.resolve(makeRes(true, 200, { data: [{ id: "acc-1", name: "Acme" }] }));
      }
      return Promise.resolve(makeRes(true, 200, {}));
    });
    const linked = { ...initial, accountId: "acc-1" };
    render(<EditContactForm params={{ id: "c1" }} initial={linked} />);
    const picker = screen.getByRole("combobox", { name: /link to an existing account/i }) as HTMLInputElement;
    await waitFor(() => expect(picker.value).toBe("Acme"));

    fireEvent.click(screen.getByRole("button", { name: "Unlink account" }));
    // Unlinked: the "Linked to" line is gone and the free-text organisation input is offered.
    expect(screen.queryByText(/Linked to/)).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Or type a new organisation")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(browserFetchMock).toHaveBeenCalled());
    const patchCall = browserFetchMock.mock.calls.find((c) => c[0] === "v1/crm/contacts/c1");
    expect(patchCall).toBeDefined();
    const body = JSON.parse((patchCall![1] as { body: string }).body) as Record<string, unknown>;
    expect(body.accountId).toBeNull();
    expect(body).toHaveProperty("accountId");
    expect(body).not.toHaveProperty("leadStatus");
  });

  it("unlinking and typing a new organisation sends accountId: null together with the new company", async () => {
    browserFetchMock.mockImplementation((path: string) => {
      if (path === "v1/crm/accounts") {
        return Promise.resolve(makeRes(true, 200, { data: [{ id: "acc-1", name: "Acme" }] }));
      }
      return Promise.resolve(makeRes(true, 200, {}));
    });
    const linked = { ...initial, accountId: "acc-1" };
    render(<EditContactForm params={{ id: "c1" }} initial={linked} />);
    await waitFor(() =>
      expect((screen.getByRole("combobox", { name: /link to an existing account/i }) as HTMLInputElement).value).toBe("Acme"),
    );

    fireEvent.click(screen.getByRole("button", { name: "Unlink account" }));
    fireEvent.change(screen.getByPlaceholderText("Or type a new organisation"), { target: { value: "Globex" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(browserFetchMock).toHaveBeenCalled());
    const patchCall = browserFetchMock.mock.calls.find((c) => c[0] === "v1/crm/contacts/c1");
    const body = JSON.parse((patchCall![1] as { body: string }).body) as Record<string, unknown>;
    expect(body).toEqual({ accountId: null, company: "Globex" });
  });
});
