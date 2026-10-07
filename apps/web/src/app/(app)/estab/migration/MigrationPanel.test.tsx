import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { MigrationPanel } from "./MigrationPanel";

describe("MigrationPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GAP-ESTAB-MIGRATION-01: a failed load shows ErrorState with retry, not 'No legacy files'", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    render(<MigrationPanel />);

    await waitFor(() => {
      expect(screen.queryByText("No legacy files registered yet.")).not.toBeInTheDocument();
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    });
  });

  it("GAP-ESTAB-MIGRATION-01: retry after error re-loads", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("net"))
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    render(<MigrationPanel />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(screen.getByText("No legacy files registered yet.")).toBeInTheDocument();
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("GAP-ESTAB-MIGRATION-02: a 500 POST never exposes raw server body", async () => {
    // Load succeeds, POST fails with a raw SQL error body.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const method = (init as RequestInit | undefined)?.method ?? "GET";
      if (method === "GET") return new Response(JSON.stringify([]), { status: 200 });
      // POST fails with a raw server body.
      return new Response('SQLSTATE 23505: duplicate key value violates unique constraint "estab_migration_legacy_no"', {
        status: 500,
        headers: { "content-type": "text/plain" },
      });
    });
    render(<MigrationPanel />);
    await waitFor(() => expect(screen.getByText("No legacy files registered yet.")).toBeInTheDocument());

    // Fill form.
    fireEvent.change(screen.getByLabelText(/Legacy file no/), { target: { value: "F/OLD/001" } });
    fireEvent.change(screen.getByLabelText(/Department/), { target: { value: "Admin" } });
    fireEvent.change(screen.getByLabelText(/Subject/), { target: { value: "Old register" } });
    fireEvent.click(screen.getByRole("button", { name: "Register file" }));

    await waitFor(() => {
      // The raw SQL error should NOT appear in the DOM.
      expect(screen.queryByText(/SQLSTATE/)).not.toBeInTheDocument();
      expect(screen.queryByText(/duplicate key/)).not.toBeInTheDocument();
    });
  });

  it("GAP-ESTAB-MIGRATION-05: empty form shows per-field errors, not a single combined message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    render(<MigrationPanel />);
    await waitFor(() => expect(screen.getByText("No legacy files registered yet.")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Register file" }));

    await waitFor(() => {
      // Per-field errors.
      expect(screen.getByText("Legacy file number is required.")).toBeInTheDocument();
      expect(screen.getByText("Department is required.")).toBeInTheDocument();
      expect(screen.getByText("Subject must be at least 3 characters.")).toBeInTheDocument();
    });
  });

  it("GAP-ESTAB-MIGRATION-05: negative page count shows field error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    render(<MigrationPanel />);
    await waitFor(() => expect(screen.getByText("No legacy files registered yet.")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Legacy file no/), { target: { value: "F/OLD/001" } });
    fireEvent.change(screen.getByLabelText(/Department/), { target: { value: "Admin" } });
    fireEvent.change(screen.getByLabelText(/Subject/), { target: { value: "Old register" } });
    fireEvent.change(screen.getByLabelText(/Pages/), { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Register file" }));

    await waitFor(() => {
      expect(screen.getByText("Pages cannot be negative.")).toBeInTheDocument();
    });
  });

  it("GAP-ESTAB-MIGRATION-06: no hard-coded #4f46e5 or raw /api/proxy in the component source", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.dirname(new URL(import.meta.url).pathname);
    const source = fs.readFileSync(path.join(dir, "MigrationPanel.tsx"), "utf8");
    expect(source).not.toContain("#4f46e5");
    expect(source).not.toMatch(/fetch\(['"]\/api\/proxy/);
  });
});
