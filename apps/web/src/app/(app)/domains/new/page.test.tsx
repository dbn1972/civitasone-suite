import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const pushMock = vi.fn();
const refreshMock = vi.fn();
const backMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock, back: backMock, replace: vi.fn() }),
}));

// The registration backend is absent in production (./availability = false).
// The original submit-path coverage runs with the flag ON so the kept
// POST / error / route-to-/domains behaviour stays tested; the "unavailable"
// block below flips it OFF to cover the honest not-available state.
const flags = vi.hoisted(() => ({ available: true }));
vi.mock("./availability", () => ({
  get DOMAIN_REGISTRATION_AVAILABLE() { return flags.available; },
}));

import NewDomainPage from "./page";
import { domainSchema } from "../schema";

function render(ui: ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const SOURCE = readFileSync(join(__dirname, "page.tsx"), "utf8");

function fill(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillValidForm() {
  fill(/Domain Name/, "example.gov.in");
  fill(/Organisation/, "Ministry of X");
  fill(/Contact Email/, "webmaster@example.gov.in");
}

describe("NewDomainPage", () => {
  let spy: MockInstance<typeof fetch>;
  beforeEach(() => {
    flags.available = true;
    vi.restoreAllMocks();
    pushMock.mockClear();
    refreshMock.mockClear();
    spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "abc" }), { status: 201, headers: { "content-type": "application/json" } }),
    );
  });

  // GAP-DOMAINS-NEW-01
  it("routes to /domains (not a dead /domains/{id}) on success", async () => {
    render(<NewDomainPage />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Register Domain" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(String(spy.mock.calls[0]![0])).toBe("/api/v1/domains");
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/domains"));
    expect(pushMock.mock.calls.every((c) => !/\/domains\/[^/]+$/.test(String(c[0])) || c[0] === "/domains")).toBe(true);
  });

  // GAP-DOMAINS-NEW-02
  it("rejects example.co.in and does not POST", async () => {
    render(<NewDomainPage />);
    fill(/Domain Name/, "example.co.in");
    fill(/Organisation/, "Ministry of X");
    fill(/Contact Email/, "webmaster@example.gov.in");
    fireEvent.click(screen.getByRole("button", { name: "Register Domain" }));
    expect(await screen.findByText(/valid \.gov\.in or \.nic\.in domain/i)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("accepts example.gov.in", async () => {
    render(<NewDomainPage />);
    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Register Domain" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  });

  it("domainType nic.in with a .gov.in name shows a field error and does not POST", async () => {
    render(<NewDomainPage />);
    fill(/Domain Name/, "example.gov.in");
    fill(/Organisation/, "Ministry of X");
    fill(/Contact Email/, "webmaster@example.gov.in");
    fireEvent.change(screen.getByLabelText(/Domain Type/), { target: { value: "nic.in" } });
    fireEvent.click(screen.getByRole("button", { name: "Register Domain" }));
    expect(await screen.findByText(/requires a \.nic\.in domain/i)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not offer the removed 'Other' domain type", () => {
    render(<NewDomainPage />);
    const select = screen.getByLabelText(/Domain Type/) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).not.toContain("other");
  });

  // GAP-DOMAINS-NEW-03
  it("rejects 'a@b' as email with the custom message (noValidate so it is reachable)", async () => {
    render(<NewDomainPage />);
    fill(/Domain Name/, "example.gov.in");
    fill(/Organisation/, "Ministry of X");
    fill(/Contact Email/, "a@b");
    fireEvent.click(screen.getByRole("button", { name: "Register Domain" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("the form has noValidate", () => {
    const { container } = render(<NewDomainPage />);
    const form = container.querySelector("form")!;
    expect(form.noValidate).toBe(true);
  });

  it("rejects a non-numeric phone", async () => {
    render(<NewDomainPage />);
    fillValidForm();
    fill(/Contact Phone/, "abc");
    fireEvent.click(screen.getByRole("button", { name: "Register Domain" }));
    expect(await screen.findByText(/valid Indian phone number/i)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("accepts a valid STD phone and POSTs", async () => {
    render(<NewDomainPage />);
    fillValidForm();
    fill(/Contact Phone/, "011-24301001");
    fireEvent.click(screen.getByRole("button", { name: "Register Domain" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  });

  // GAP-DOMAINS-NEW-06
  it("does NOT lower-case the domain name on each keystroke (caret bug)", () => {
    render(<NewDomainPage />);
    const input = screen.getByLabelText(/Domain Name/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ABC" } });
    expect(input.value).toBe("ABC");
  });

  it("lower-cases and trims the domain name on blur", () => {
    render(<NewDomainPage />);
    const input = screen.getByLabelText(/Domain Name/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  Example.GOV.in  " } });
    fireEvent.blur(input);
    expect(input.value).toBe("example.gov.in");
  });

  it("submits a lower-cased domain name even if typed in mixed case", async () => {
    render(<NewDomainPage />);
    fill(/Domain Name/, "Example.GOV.in");
    fill(/Organisation/, "Ministry of X");
    fill(/Contact Email/, "webmaster@example.gov.in");
    fireEvent.click(screen.getByRole("button", { name: "Register Domain" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const body = JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.domainName).toBe("example.gov.in");
  });

  // GAP-DOMAINS-NEW-04
  it("source contains no hard-coded hex colours", () => {
    const hex = SOURCE.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex).toEqual([]);
  });

  // GAP-DOMAINS-NEW-05
  it("shows a DPDP purpose/consent notice for the contact data", () => {
    render(<NewDomainPage />);
    expect(screen.getByText(/collected only to reach the domain owner/i)).toBeInTheDocument();
  });
});

// GAP2-DOMAINS-NEW-07: with no registration backend the form is honest about it
// and never issues the doomed POST, while field validation still works.
describe("NewDomainPage (registration backend unavailable)", () => {
  let spy: MockInstance<typeof fetch>;
  beforeEach(() => {
    flags.available = false;
    vi.restoreAllMocks();
    pushMock.mockClear();
    spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 201 }));
  });

  function submitForm() {
    fireEvent.submit(screen.getByRole("button", { name: /register/i }).closest("form")!);
  }

  it("shows a not-available notice and disables the Register submit", () => {
    render(<NewDomainPage />);
    expect(screen.getByText(/not yet connected to a backend service, so this form cannot be submitted/i)).toBeInTheDocument();
    expect((screen.getByRole("button", { name: /register/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("never POSTs or routes away, even when the form is submitted directly", () => {
    render(<NewDomainPage />);
    fillValidForm();
    submitForm();
    expect(spy).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("still shows field-level validation errors", async () => {
    render(<NewDomainPage />);
    fill(/Domain Name/, "example.co.in");
    submitForm();
    expect(await screen.findByText(/valid \.gov\.in or \.nic\.in domain/i)).toBeInTheDocument();
  });
});

// GAP-DOMAINS-NEW-06: the lower-case + trim of the submitted domain name lives
// in the shared schema, so it is asserted here independent of the submit path.
describe("domainSchema normalisation", () => {
  it("lower-cases and trims a mixed-case domain name", () => {
    const parsed = domainSchema.safeParse({
      domainName: "  Example.GOV.in ",
      organisation: "Ministry of X",
      contactEmail: "webmaster@example.gov.in",
      contactPhone: "",
      department: "",
      state: "",
      domainType: "gov.in",
      notes: "",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.domainName).toBe("example.gov.in");
  });
});
