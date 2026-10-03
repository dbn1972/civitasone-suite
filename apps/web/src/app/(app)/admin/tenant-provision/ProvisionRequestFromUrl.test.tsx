import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const params = { current: new URLSearchParams() };
vi.mock("next/navigation", () => ({ useSearchParams: () => params.current, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { ProvisionRequestFromUrl } from "./ProvisionRequestFromUrl";

const ID = "6f1c1d5e-3a0b-4f0e-9c1d-2b7d8a9e4c11";

describe("ProvisionRequestFromUrl (GAP-ADMIN-ONBOARDING-07)", () => {
  beforeEach(() => { vi.restoreAllMocks(); params.current = new URLSearchParams(); });

  it("renders nothing and fetches nothing without a request id", () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const { container } = render(<ProvisionRequestFromUrl />);
    expect(container).toBeEmptyDOMElement();
    expect(spy).not.toHaveBeenCalled();
  });

  it("never sends a value that is not a UUID", () => {
    params.current = new URLSearchParams({ requestId: "../../admin/tenants" });
    const spy = vi.spyOn(globalThis, "fetch");
    render(<ProvisionRequestFromUrl />);
    expect(spy).not.toHaveBeenCalled();
  });

  it("loads the request by id and shows it with the masked contact", async () => {
    params.current = new URLSearchParams({ requestId: ID });
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: ID, org: "Dept of Roads", contact: "J*** D*** · j***@dept.gov.in", requested: "2026-10-01", assigned: "", stage: "new request" } }), { status: 200 }),
    );
    render(<ProvisionRequestFromUrl />);
    expect(screen.getByRole("status")).toHaveTextContent(/Loading/);
    await waitFor(() => expect(screen.getByText("Dept of Roads")).toBeInTheDocument());
    expect(spy.mock.calls[0]![0]).toBe(`/api/proxy/v1/admin/onboarding/${ID}`);
    expect(screen.getByText(/j\*\*\*@dept\.gov\.in/)).toBeInTheDocument();
  });

  it("404 says not found; a network failure offers retry", async () => {
    params.current = new URLSearchParams({ requestId: ID });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 404 }));
    const { unmount } = render(<ProvisionRequestFromUrl />);
    await waitFor(() => expect(screen.getByText(/was not found/)).toBeInTheDocument());
    unmount();
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("offline"));
    render(<ProvisionRequestFromUrl />);
    await waitFor(() => expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument());
  });
});
