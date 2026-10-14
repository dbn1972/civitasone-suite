import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => ["works_admin"],
  hasAnyRole: (roles: string[], allowed: string[]) => allowed.some((r) => roles.includes(r)),
}));
vi.mock("./BillingActions", () => ({ BillingActions: () => null }));
const getBillsForWork = vi.fn();
vi.mock("../../_data/loaders", () => ({ getBillsForWork: (...a: unknown[]) => getBillsForWork(...a) }));

import BillingDetailPage from "./page";

const row = (o: Record<string, unknown>) => ({
  id: "b",
  workId: "w",
  billNo: "RA-01",
  work: "W",
  mode: "e-MB",
  gross: "9007199254740993",
  netPayable: "1",
  stage: "",
  status: "pending",
  rawStatus: "so_finalized",
  ...o,
});

describe("BillingDetailPage (WORKID-05/06)", () => {
  it("Total Gross sums paise with BigInt (no float loss) and the Status column uses the granular label", async () => {
    getBillsForWork.mockResolvedValue({
      source: "api",
      data: [row({ id: "b1" }), row({ id: "b2", billNo: "RA-02", gross: "1", rawStatus: "do_finalized" })],
    });
    const ui = await BillingDetailPage({ params: { workId: "11111111-1111-1111-1111-111111111111" } });
    render(ui);
    // 9007199254740993 + 1 = 9007199254740994 paise = ₹9,00,71,99,25,47,409.94 (exact; a float sum would lose the last digit).
    expect(screen.getByText(/9,00,71,99,25,47,409\.94/)).toBeInTheDocument();
    // granular label identical to the stepper's "Current:" text
    expect(screen.getAllByText(/^so finalized$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^do finalized$/i).length).toBeGreaterThan(0);
  });

  it("counts Finalized/Submitted from the real raw status codes", async () => {
    getBillsForWork.mockResolvedValue({
      source: "api",
      data: [row({ id: "b1", rawStatus: "do_finalized" }), row({ id: "b2", rawStatus: "submitted" }), row({ id: "b3", rawStatus: "submitted" })],
    });
    const ui = await BillingDetailPage({ params: { workId: "11111111-1111-1111-1111-111111111111" } });
    render(ui);
    const statText = (label: string) => screen.getAllByText(label)[0].parentElement!.textContent ?? "";
    expect(statText("Finalized")).toMatch(/1/);
    expect(statText("Submitted")).toMatch(/2/);
  });
});
