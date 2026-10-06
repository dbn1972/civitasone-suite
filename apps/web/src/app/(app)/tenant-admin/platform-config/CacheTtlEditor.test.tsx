import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { CacheTtlEditor } from "./CacheTtlEditor";

describe("CacheTtlEditor — GAP-TENANT-ADMIN-PLATFORM-CONFIG-01", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("PATCHes the new TTL and shows a saved confirmation", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "updated" }), { status: 200 }));
    render(<CacheTtlEditor cacheTtl={{ finance: 60, reports: 300 }} />);
    fireEvent.change(screen.getByLabelText(/Finance cache TTL/i), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: /Save TTL changes/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      "/api/proxy/v1/admin/platform-config",
      expect.objectContaining({ method: "PATCH" }),
    ));
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.cacheTtl).toMatchObject({ finance: 120, reports: 300 });
    await waitFor(() => expect(screen.getByText(/Cache TTL updated/i)).toBeInTheDocument());
  });

  it("rejects an out-of-range TTL inline and does not call the API", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<CacheTtlEditor cacheTtl={{ finance: 60 }} />);
    fireEvent.change(screen.getByLabelText(/Finance cache TTL/i), { target: { value: "4" } }); // below min 5
    expect(screen.getByRole("button", { name: /Save TTL changes/i })).toBeDisabled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a non-integer / negative TTL", () => {
    render(<CacheTtlEditor cacheTtl={{ finance: 60 }} />);
    fireEvent.change(screen.getByLabelText(/Finance cache TTL/i), { target: { value: "-10" } });
    expect(screen.getByRole("button", { name: /Save TTL changes/i })).toBeDisabled();
  });
});
