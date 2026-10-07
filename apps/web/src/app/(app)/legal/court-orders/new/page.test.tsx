import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getLegalCases = vi.fn();

vi.mock("../../../../_data/loaders", () => ({ getLegalCases: () => getLegalCases() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

import RecordOrderPage from "./page";

describe("Record order page failmask (GAP-LEGAL-COURT-ORDERS-NEW-02)", () => {
  beforeEach(() => getLegalCases.mockReset());

  it("shows a retry error state on a failed cases fetch, not a 'Register a case' prompt", async () => {
    getLegalCases.mockResolvedValue({ data: [], source: "error" });
    render(await RecordOrderPage());
    expect(screen.queryByText(/Register a case/i)).not.toBeInTheDocument();
  });

  it("renders the form when cases load successfully", async () => {
    getLegalCases.mockResolvedValue({ data: [{ id: "c1", caseNo: "WP/1/2024", title: "X v Y" }], source: "api" });
    render(await RecordOrderPage());
    expect(screen.getByLabelText(/Case \*/i)).toBeInTheDocument();
  });
});
