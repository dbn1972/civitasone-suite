import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  }),
}));

import NewContractorPage from "./page";

describe("NewContractorPage — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a clerk-safe message, never the raw backend text, when registering a contractor fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "duplicate gst constraint" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<NewContractorPage />);
    fireEvent.change(screen.getByLabelText(/Contractor name/i), { target: { value: "ABC Constructions" } });
    fireEvent.click(screen.getByRole("button", { name: "Register Contractor" }));

    // The error banner is a plain div (no role="alert") in this component.
    await waitFor(() => expect(screen.getByText(/This contractor was changed by someone else\. Refresh to see the latest version, then try again\./)).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/duplicate gst/i);
    expect(document.body.textContent).not.toMatch(/\b409\b/);
  });

  // GAP-WORKS-CONTRACTORS-NEW-01: a malformed PAN is caught client-side; fetch is never called.
  it("blocks submission and shows an inline PAN error for a malformed PAN", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<NewContractorPage />);
    fireEvent.change(screen.getByLabelText(/Contractor name/i), { target: { value: "ABC Constructions" } });
    fireEvent.change(screen.getByLabelText("PAN"), { target: { value: "BADPAN" } });
    fireEvent.click(screen.getByRole("button", { name: "Register Contractor" }));
    await waitFor(() => expect(screen.getByText(/valid 10-character PAN/i)).toBeInTheDocument());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // GAP-WORKS-CONTRACTORS-NEW-01: a valid body reaches the API.
  it("submits when all identifiers are valid", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "x" }), { status: 202, headers: { "content-type": "application/json" } }),
    );
    render(<NewContractorPage />);
    fireEvent.change(screen.getByLabelText(/Contractor name/i), { target: { value: "ABC Constructions" } });
    fireEvent.change(screen.getByLabelText("PAN"), { target: { value: "AAAPZ1234C" } });
    fireEvent.change(screen.getByLabelText(/Mobile number/i), { target: { value: "9876543210" } });
    fireEvent.click(screen.getByRole("button", { name: "Register Contractor" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(await screen.findByText(/Contractor registered\. Redirecting/i)).toBeInTheDocument();
  });

  // GAP-WORKS-CONTRACTORS-NEW-03 (DPDP): a purpose/notice is shown above the identifiers.
  it("renders a DPDP data-protection notice (role=note)", () => {
    render(<NewContractorPage />);
    const note = screen.getByRole("note", { name: /data protection notice/i });
    expect(note).toBeInTheDocument();
    expect(note.textContent).toMatch(/empanelment/i);
  });

  // GAP-WORKS-CONTRACTORS-NEW-04: Odisha-consistent GSTIN placeholder (21..), not Karnataka (29..).
  it("uses an Odisha (21) GSTIN placeholder", () => {
    render(<NewContractorPage />);
    expect(screen.getByLabelText(/GSTIN/i)).toHaveAttribute("placeholder", "21ABCDE1234F1Z5");
  });
});

describe("NewContractorPage — CLOS3-S3-19 duplicate-submit latch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });
  const posts = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === "POST");

  it("a second submit while the redirect is pending does not create a duplicate contractor", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ id: "c1" }), { status: 201, headers: { "content-type": "application/json" } }),
    );
    render(<NewContractorPage />);
    fireEvent.change(screen.getByLabelText(/Contractor name/i), { target: { value: "ABC Constructions" } });
    const btn = screen.getByRole("button", { name: "Register Contractor" });
    const form = btn.closest("form") as HTMLFormElement;
    fireEvent.click(btn);
    await screen.findByText(/Contractor registered\. Redirecting/);
    expect(screen.getByRole("button", { name: /Saving|Register Contractor/ })).toBeDisabled();
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(posts(spy)).toHaveLength(1);
    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(posts(spy)).toHaveLength(1);
  });

  it("a failed save does not latch: the button re-enables and a resubmit POSTs again", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("", { status: 500 }));
    render(<NewContractorPage />);
    fireEvent.change(screen.getByLabelText(/Contractor name/i), { target: { value: "ABC Constructions" } });
    fireEvent.click(screen.getByRole("button", { name: "Register Contractor" }));
    await waitFor(() => expect(posts(spy)).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole("button", { name: "Register Contractor" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Register Contractor" }));
    await waitFor(() => expect(posts(spy)).toHaveLength(2));
  });
});
