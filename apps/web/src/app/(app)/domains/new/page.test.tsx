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
    expect(String(spy.mock.calls[0]![0])).toBe("/api/proxy/v1/admin/custom-domains");
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/domains"));
    expect(pushMock.mock.calls.every((c) => !/\/domains\/[^/]+$/.test(String(c[0])) || c[0] === "/domains")).toBe(true);
  });

  // GAP-DOMAINS-NEW-02
  it("rejects example.co.in and does not POST", async () => {
    render(<NewDomainPage />);
    fill(/Domain Name/, "example.co.in");
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

  // GAP-DOMAINS-NEW-03 (email/phone validation now lives in schema.test.ts; the form no longer collects contact data)
  it("the form has noValidate", () => {
    const { container } = render(<NewDomainPage />);
    const form = container.querySelector("form")!;
    expect(form.noValidate).toBe(true);
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
    fireEvent.click(screen.getByRole("button", { name: "Register Domain" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const body = JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.domain).toBe("example.gov.in");
  });

  // GAP-DOMAINS-NEW-04
  it("source contains no hard-coded hex colours", () => {
    const hex = SOURCE.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex).toEqual([]);
  });

});

// GAP-DOMAINS-NEW-05 / owner decision D4c #12 (2026-10-27): registration is re-pointed at the
// existing admin custom-domains API (role-checked, validated, audited), which stores only the
// domain and its verification method. The form therefore sends exactly that and nothing else.
describe("NewDomainPage -> admin custom-domains API (D4c #12)", () => {
  let spy: MockInstance<typeof fetch>;
  beforeEach(() => {
    flags.available = true;
    vi.restoreAllMocks();
    spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "abc", status: "accepted" }), { status: 202, headers: { "content-type": "application/json" } }),
    );
  });

  it("POSTs only { domain, verificationMethod } to /api/proxy/v1/admin/custom-domains", async () => {
    render(<NewDomainPage />);
    fill(/Domain Name/, "Example.GOV.in");
    fireEvent.click(screen.getByRole("button", { name: "Register Domain" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(String(spy.mock.calls[0]![0])).toBe("/api/proxy/v1/admin/custom-domains");
    const init = spy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ domain: "example.gov.in", verificationMethod: "dns_txt" });
  });

  it("lets the officer choose the CNAME verification method", async () => {
    render(<NewDomainPage />);
    fill(/Domain Name/, "example.gov.in");
    fireEvent.change(screen.getByLabelText(/Verification method/i), { target: { value: "dns_cname" } });
    fireEvent.click(screen.getByRole("button", { name: "Register Domain" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string).verificationMethod).toBe("dns_cname");
  });

  it("does not collect contact details the API has nowhere to store", () => {
    render(<NewDomainPage />);
    expect(screen.queryByLabelText(/Contact Email/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Contact Phone/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Organisation/)).not.toBeInTheDocument();
  });

  it("the shipped availability flag is ON (the backend exists)", async () => {
    const actual = await vi.importActual<typeof import("./availability")>("./availability");
    expect(actual.DOMAIN_REGISTRATION_AVAILABLE).toBe(true);
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
