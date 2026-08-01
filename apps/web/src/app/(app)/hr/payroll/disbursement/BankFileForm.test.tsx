import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// jsdom does not implement URL.createObjectURL / revokeObjectURL.
beforeEach(() => {
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(() => "blob:mock");
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
});

import { BankFileForm } from "./BankFileForm";

const runs = [{ id: "run-1", payPeriod: "2026-07", netAmount: 90000 }];

describe("BankFileForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("generates and downloads the bank file on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Blob(["csv content"]), {
        status: 200,
        headers: { "content-disposition": 'attachment; filename="bank_transfer_run-1.csv"' },
      }),
    );

    render(<BankFileForm runs={runs} />);
    fireEvent.click(screen.getByText("Generate & Download"));

    await waitFor(() => expect(screen.getByText("Generate this bank transfer file?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Generate file"));

    await waitFor(() => {
      expect(screen.getByText(/generated and downloaded/)).toBeInTheDocument();
    });
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "SPONSOR_CONFIG_MISSING", message: "sponsor bank configuration is required" } }), {
        status: 422,
      }),
    );

    render(<BankFileForm runs={runs} />);
    fireEvent.click(screen.getByText("Generate & Download"));

    await waitFor(() => expect(screen.getByText("Generate this bank transfer file?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Generate file"));

    await waitFor(() => {
      expect(screen.getByText(/sponsor bank configuration is required/)).toBeInTheDocument();
    });
  });
});
