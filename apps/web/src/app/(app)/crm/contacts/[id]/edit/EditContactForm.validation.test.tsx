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

vi.mock("@/lib/crm/dataQuality", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/dataQuality")>();
  return { ...actual, duplicateCheck: vi.fn() };
});

import EditContactForm from "./EditContactForm";
import * as dq from "@/lib/crm/dataQuality";

/** A fetch Response stand-in with clone(), like a real one: the body can be read once per copy. */
function makeRes(ok: boolean, status: number, body: unknown): Response {
  const make = (): Response =>
    ({ ok, status, headers: new Headers(), json: async () => body, clone: make }) as unknown as Response;
  return make();
}

const initial = {
  name: "Asha Rao",
  email: "asha@example.com",
  phone: "9900000000",
  organization: "Acme",
  designation: "Director",
  city: "Bhubaneswar",
  leadStatus: "qualified",
  marketingConsent: false,
};

const other: dq.DuplicateCandidate = {
  id: "c-other",
  matchedFields: ["email"],
  score: 0.95,
  name: "Someone Else",
  email: "taken@example.com",
};
const self: dq.DuplicateCandidate = { id: "c1", matchedFields: ["email"], score: 1, name: "Asha Rao" };

beforeEach(() => {
  pushMock.mockReset();
  browserFetchMock.mockReset();
  browserFetchMock.mockResolvedValue(makeRes(true, 200, {}));
  vi.mocked(dq.duplicateCheck).mockReset();
});

describe("EditContactForm field validation (GAP-CRM-CONTACTS-DETAIL-EDIT-05)", () => {
  // The exact body crm-service answers with for a bad mobile: the format code is
  // the zod issue MESSAGE under VALIDATION_FAILED, not the top-level code.
  const realPhoneError = {
    code: "VALIDATION_FAILED",
    message: "invalid request",
    correlationId: "corr-1",
    retryable: false,
    fieldErrors: [{ field: "phone", message: "INVALID_MOBILE" }],
  };

  function failPatchWith(status: number, body: unknown) {
    browserFetchMock.mockImplementation((path: string) =>
      Promise.resolve(path === "v1/crm/contacts/c1" ? makeRes(false, status, body) : makeRes(true, 200, {})),
    );
  }

  it("lands the real crm-service INVALID_MOBILE 400 under Phone, linked by aria-describedby", async () => {
    failPatchWith(400, realPhoneError);
    renderWithIntl(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    const phone = screen.getByLabelText("Phone");
    await waitFor(() => expect(phone).toHaveAttribute("aria-invalid", "true"));
    const msg = document.getElementById(phone.getAttribute("aria-describedby")!.split(" ")[0]!)!;
    expect(msg).toHaveTextContent(/valid 10-digit Indian mobile/i);
    expect(msg).toHaveAttribute("role", "alert");
    // It is a field error, not the generic banner, and the form stays open for the fix.
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("lands several real format errors, each under its own field", async () => {
    failPatchWith(400, {
      code: "VALIDATION_FAILED",
      message: "invalid request",
      fieldErrors: [
        { field: "gstin", message: "INVALID_GSTIN" },
        { field: "pincode", message: "INVALID_PINCODE" },
      ],
    });
    renderWithIntl(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    fireEvent.change(screen.getByLabelText("GSTIN"), { target: { value: "BAD" } });
    fireEvent.change(screen.getByLabelText("PIN code"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(screen.getByLabelText("GSTIN")).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByLabelText("PIN code")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Phone")).not.toHaveAttribute("aria-invalid");
  });

  it("a non-format 400 is not mis-filed under a field: it shows the generic save message", async () => {
    failPatchWith(400, {
      code: "VALIDATION_FAILED",
      message: "invalid request",
      fieldErrors: [{ field: "email", message: "Invalid email" }],
    });
    renderWithIntl(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    fireEvent.change(screen.getByLabelText("Designation"), { target: { value: "VP" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/couldn.t save the contact/i);
    expect(alert.textContent).not.toMatch(/VALIDATION_FAILED|Invalid email/);
    expect(screen.getByLabelText("Phone")).not.toHaveAttribute("aria-invalid");
  });
});

describe("EditContactForm duplicate check (GAP-CRM-CONTACTS-DETAIL-EDIT-05)", () => {
  it("changing the email to another contact's shows the duplicate panel, never listing the contact itself", async () => {
    vi.mocked(dq.duplicateCheck).mockResolvedValue([self, other]);
    renderWithIntl(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    const email = screen.getByLabelText("Email");
    fireEvent.change(email, { target: { value: "taken@example.com" } });
    fireEvent.blur(email);

    expect(await screen.findByText(/potential duplicates found/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Someone Else" });
    expect(link).toHaveAttribute("href", "/crm/contacts/c-other");
    // The record being edited is excluded: it is its own best match and must not be flagged.
    expect(screen.queryByRole("link", { name: "Asha Rao" })).not.toBeInTheDocument();
    expect(vi.mocked(dq.duplicateCheck)).toHaveBeenCalledWith(
      expect.objectContaining({ email: "taken@example.com" }),
    );
    // Only the CHANGED identifier is sent: the unchanged phone is not re-checked against itself.
    expect(vi.mocked(dq.duplicateCheck).mock.calls[0]![0]).not.toHaveProperty("phone", expect.any(String));
  });

  it("shows no panel when the only match is the contact itself", async () => {
    vi.mocked(dq.duplicateCheck).mockResolvedValue([self]);
    renderWithIntl(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    const email = screen.getByLabelText("Email");
    fireEvent.change(email, { target: { value: "asha.new@example.com" } });
    fireEvent.blur(email);
    await waitFor(() => expect(vi.mocked(dq.duplicateCheck)).toHaveBeenCalled());
    expect(screen.queryByText(/potential duplicates found/i)).not.toBeInTheDocument();
  });

  it("does not run a check when the email/phone were not changed", () => {
    renderWithIntl(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    fireEvent.blur(screen.getByLabelText("Email"));
    fireEvent.blur(screen.getByLabelText("Phone"));
    expect(vi.mocked(dq.duplicateCheck)).not.toHaveBeenCalled();
  });

  it("a failed check is flagged but never blocks saving", async () => {
    vi.mocked(dq.duplicateCheck).mockRejectedValue(new Error("down"));
    renderWithIntl(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    const phone = screen.getByLabelText("Phone");
    fireEvent.change(phone, { target: { value: "9811111111" } });
    fireEvent.blur(phone);
    expect(await screen.findByText(/duplicate check unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled();
  });
});

describe("EditContactForm identifiers (GAP-CRM-CONTACTS-NEW-03 / -06)", () => {
  it("explains why PAN and GSTIN are collected, tied to the inputs via aria-describedby", () => {
    renderWithIntl(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    const text = (el: HTMLElement) =>
      el.getAttribute("aria-describedby")!.split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    expect(text(screen.getByLabelText("PAN"))).toMatch(/KYC\/tax.*role-scoped and logged/i);
    expect(text(screen.getByLabelText("GSTIN"))).toMatch(/invoicing and tax.*role-scoped and logged/i);
  });

  it("keeps the notice linked alongside a field error", async () => {
    browserFetchMock.mockImplementation((path: string) =>
      Promise.resolve(
        path === "v1/crm/contacts/c1"
          ? makeRes(false, 400, { code: "VALIDATION_FAILED", fieldErrors: [{ field: "pan", message: "INVALID_PAN" }] })
          : makeRes(true, 200, {}),
      ),
    );
    renderWithIntl(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    fireEvent.change(screen.getByLabelText("PAN"), { target: { value: "BAD" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    const pan = screen.getByLabelText("PAN");
    await waitFor(() => expect(pan).toHaveAttribute("aria-invalid", "true"));
    expect(pan.getAttribute("aria-describedby")!.split(" ")).toHaveLength(2);
  });

  it("uses an Odisha GSTIN example, not a Karnataka (29) one", () => {
    renderWithIntl(<EditContactForm params={{ id: "c1" }} initial={initial} />);
    expect(screen.getByPlaceholderText("21ABCDE1234F1Z5")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("29ABCDE1234F1Z5")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("751001")).toBeInTheDocument();
  });
});
