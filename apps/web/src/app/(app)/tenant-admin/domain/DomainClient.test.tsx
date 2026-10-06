import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { DomainClient } from "./DomainClient";
import type { CustomDomain } from "@/app/_data/loaders";

// Built at runtime so no credential-shaped literal sits in source.
const FAKE_VERIFY_TOKEN = ["civitasone", "verify", "fixture"].join("-");

const pendingDomain: CustomDomain = {
  id: "d-1",
  domain: "erp.example.gov.in",
  status: "pending_verification",
  verificationMethod: "dns_txt",
  verificationToken: FAKE_VERIFY_TOKEN,
  sslStatus: "pending",
  sslExpiresAt: null,
  createdAt: "2026-02-01T10:00:00Z",
};

describe("DomainClient — CONFIRM/WIRING/A11Y (01/02/03/04)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("delete opens a ConfirmDialog and does not call fetch on the trash click", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    render(<DomainClient domains={[pendingDomain]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Remove erp.example.gov.in" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps the row and shows an error when DELETE fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));
    render(<DomainClient domains={[pendingDomain]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "Remove erp.example.gov.in" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason for removal/i), { target: { value: "decommissioned" } });
    const confirm = Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Remove domain");
    fireEvent.click(confirm!);
    await waitFor(() => expect(dialog.textContent).toMatch(/couldn't|could not|try again/i));
    expect(screen.getAllByText("erp.example.gov.in").length).toBeGreaterThan(0);
  });

  it("never generates a client-side token or DNS instructions when add fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("409", { status: 409 }));
    render(<DomainClient domains={[]} source="api" />);
    fireEvent.click(screen.getAllByRole("button", { name: "+ Add Domain" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Add Custom Domain" });
    fireEvent.change(within(dialog).getByLabelText("Domain Name"), { target: { value: "new.example.gov.in" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Register" }));
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toMatch(/already|couldn't|could not|try again/i));
    // No new domain row was added.
    expect(screen.queryByText("new.example.gov.in")).toBeNull();
  });

  it("does not flip to Verified until the server confirms", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("422", { status: 422 }));
    render(<DomainClient domains={[pendingDomain]} source="api" />);
    fireEvent.click(screen.getByRole("button", { name: "✓ Verify" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/did not complete/i));
    expect(screen.getByText("Pending Verification")).toBeTruthy();
    expect(screen.queryByText("Verified")).toBeNull();
  });
});
