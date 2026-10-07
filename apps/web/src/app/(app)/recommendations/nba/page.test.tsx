import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../_data", () => ({ getRecNba: vi.fn() }));

import { getRecNba } from "../_data";
import Page from "./page";

const mNba = vi.mocked(getRecNba);

describe("nba page copy (GAP-RECOMMENDATIONS-NBA-01)", () => {
  beforeEach(() => {
    mNba.mockResolvedValue({ data: [], source: "api" } as never);
  });

  it("subtitle is plain language, with no hyphenated internal service name", async () => {
    render(await Page());
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(/Next Best Action/i);
    expect(screen.queryByText(/recommendation-service/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Predictive \/ NBA signals from/i)).not.toBeInTheDocument();
  });
});
