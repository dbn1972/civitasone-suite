import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { RiskSummary } from "@civitasone/types";

const replaceMock = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: replaceMock }),
  useSearchParams: () => new URLSearchParams(search),
}));

import { RiskTable } from "./RiskTable";

const risk = (riskCode: string, riskScore: number): RiskSummary =>
  ({ id: riskCode, riskCode, title: `Risk ${riskCode}`, riskScore, status: "open", owner: "CFO" }) as unknown as RiskSummary;

const ITEMS = [risk("R-HI", 20), risk("R-MED", 9), risk("R-LO", 2)];

describe("RiskTable band filter (GAP-AUDIT-RISK-REGISTER-05)", () => {
  it("?band=medium shows only the medium-band row", () => {
    search = "band=medium";
    render(<RiskTable items={ITEMS} />);
    expect(screen.getByText("R-MED")).toBeInTheDocument();
    expect(screen.queryByText("R-HI")).not.toBeInTheDocument();
    expect(screen.queryByText("R-LO")).not.toBeInTheDocument();
  });

  it("picking Medium keeps the band in the URL (?band=medium)", () => {
    search = "";
    replaceMock.mockReset();
    render(<RiskTable items={ITEMS} />);
    fireEvent.click(screen.getAllByText("Medium")[0]);
    expect(replaceMock).toHaveBeenCalledWith("/audit/risk-register?band=medium");
  });
});
