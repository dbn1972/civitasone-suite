import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { CreateCaseForm } from "./CreateCaseForm";

const CASE_TYPES = [
  { id: "11111111-1111-4111-8111-111111111111", code: "criminal", name: "Criminal Case" },
  { id: "22222222-2222-4222-8222-222222222222", code: "writ", name: "Writ Petition" },
];

function mockFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = vi.fn(impl as unknown as typeof fetch) as unknown as typeof fetch;
}

describe("CreateCaseForm — case-type master (GAP-LEGAL-CASES-NEW-01)", () => {
  beforeEach(() => {
    pushMock.mockReset();
    refreshMock.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads case types on mount and sends the chosen caseTypeId on submit", async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    mockFetch(async (url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url.includes("/v1/legal/case-types")) {
        return new Response(JSON.stringify({ items: CASE_TYPES }), { status: 200 });
      }
      // POST /v1/legal/cases
      return new Response(JSON.stringify({ id: "case-1", status: "accepted" }), { status: 202 });
    });

    render(<CreateCaseForm />);

    // Options populate from the master once the mount fetch resolves.
    await waitFor(() => expect(screen.getByRole("option", { name: "Criminal Case" })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Case number *"), { target: { value: "CR/99/2026" } });
    fireEvent.change(screen.getByLabelText("Court / Forum *"), { target: { value: "Sessions Court" } });
    fireEvent.change(screen.getByLabelText("Case title *"), { target: { value: "State vs. X" } });
    fireEvent.change(screen.getByLabelText("Case type"), {
      target: { value: "11111111-1111-4111-8111-111111111111" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Register case" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/legal/list"));
    const post = calls.find((c) => c.url.includes("/v1/legal/cases") && c.body);
    expect(post?.body).toMatchObject({ caseTypeId: "11111111-1111-4111-8111-111111111111", caseNo: "CR/99/2026" });
  });

  it("shows an honest hint and disables the select when the master is empty", async () => {
    mockFetch(async (url) => {
      if (url.includes("/v1/legal/case-types")) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "case-1", status: "accepted" }), { status: 202 });
    });

    render(<CreateCaseForm />);

    await waitFor(() => expect(screen.getByText(/No case types are configured yet/)).toBeInTheDocument());
    expect(screen.getByLabelText("Case type")).toBeDisabled();
  });

  it("omits caseTypeId when none is chosen (falls back to caseNo heuristic server-side)", async () => {
    const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
    mockFetch(async (url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (url.includes("/v1/legal/case-types")) {
        return new Response(JSON.stringify({ items: CASE_TYPES }), { status: 200 });
      }
      return new Response(JSON.stringify({ id: "case-2", status: "accepted" }), { status: 202 });
    });

    render(<CreateCaseForm />);
    await waitFor(() => expect(screen.getByRole("option", { name: "Writ Petition" })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Case number *"), { target: { value: "WP/1/2026" } });
    fireEvent.change(screen.getByLabelText("Court / Forum *"), { target: { value: "High Court" } });
    fireEvent.change(screen.getByLabelText("Case title *"), { target: { value: "A vs. B" } });
    fireEvent.click(screen.getByRole("button", { name: "Register case" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const post = calls.find((c) => c.url.includes("/v1/legal/cases") && c.body);
    expect(post?.body).not.toHaveProperty("caseTypeId");
  });
});
