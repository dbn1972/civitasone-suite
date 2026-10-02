import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const browserJsonMock = vi.fn();
vi.mock("@/lib/api/browserClient", () => ({ browserJson: (...a: unknown[]) => browserJsonMock(...a) }));

import { BankAccountForm } from "./BankAccountForm";

function fill(v: Record<string, string>) {
  for (const [label, value] of Object.entries(v)) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Add bank account" }));
}

describe("BankAccountForm (GAP-FINANCE-CONFIG-01)", () => {
  beforeEach(() => browserJsonMock.mockReset().mockResolvedValue({ id: "x", status: "accepted" }));

  it("rejects a malformed IFSC client-side and does not submit", async () => {
    render(<BankAccountForm />);
    fill({ "Bank name": "State Bank of India", "Account number": "00112233445566", IFSC: "SBIN123" });
    expect(await screen.findByText("IFSC must look like SBIN0001234.")).toBeInTheDocument();
    expect(browserJsonMock).not.toHaveBeenCalled();
  });

  it("submits a valid account (IFSC upper-cased) and confirms by last 4 only", async () => {
    render(<BankAccountForm />);
    fill({ "Bank name": "State Bank of India", "Account number": "00112233445566", IFSC: "sbin0001234" });
    await waitFor(() => expect(browserJsonMock).toHaveBeenCalledTimes(1));
    const [path, init] = browserJsonMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("v1/finance/bank-accounts");
    expect(JSON.parse(String(init.body))).toMatchObject({ bankName: "State Bank of India", accountNo: "00112233445566", ifsc: "SBIN0001234", accountType: "current" });
    expect(await screen.findByText(/ending 5566 submitted/)).toBeInTheDocument();
    expect(screen.queryByText(/00112233445566/)).not.toBeInTheDocument();
  });
});
