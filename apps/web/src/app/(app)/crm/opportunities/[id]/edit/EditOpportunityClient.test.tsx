import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/lib/testUtils/intl";
import * as op from "@/lib/crm/opportunity";
import { EditOpportunityClient } from "./EditOpportunityClient";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

vi.mock("@/lib/crm/opportunity", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/opportunity")>();
  return {
    ...actual,
    getOpportunity: vi.fn(),
    getPipelines: vi.fn(),
    updateOpportunity: vi.fn(),
  };
});

const pipeline: op.Pipeline = {
  id: "p1",
  name: "Enterprise",
  enabled: true,
  stages: [{ key: "qual", name: "Qualify", mandatoryFields: [], gate: false }],
};
const opportunity: op.Opportunity = {
  id: "d1",
  name: "Datacentre refresh",
  pipelineId: "p1",
  stage: "qual",
  valueMinor: "150000",
  probability: 40,
  product: "Servers",
  quantity: 2,
  competitors: [],
  nextStep: "",
  expectedCloseDate: "2026-09-01",
  version: 3,
};

beforeEach(() => {
  pushMock.mockReset();
  vi.mocked(op.getPipelines).mockReset().mockResolvedValue({ data: [pipeline], source: "api" });
  vi.mocked(op.getOpportunity).mockReset();
  vi.mocked(op.updateOpportunity).mockReset();
});

describe("EditOpportunityClient (GAP-CRM-OPPORTUNITIES-06)", () => {
  it("loads the opportunity and renders the edit form prefilled", async () => {
    vi.mocked(op.getOpportunity).mockResolvedValue({ data: opportunity, source: "api" });
    renderWithIntl(<EditOpportunityClient id="d1" />);
    await waitFor(() => expect(screen.getByText("Edit opportunity")).toBeInTheDocument());
    expect((screen.getByLabelText(/opportunity name/i) as HTMLInputElement).value).toBe("Datacentre refresh");
    expect(op.getOpportunity).toHaveBeenCalledWith("d1");
  });

  it("shows a retriable error (not a blank form) when the load fails", async () => {
    vi.mocked(op.getOpportunity).mockResolvedValue({ data: null, source: "error" });
    renderWithIntl(<EditOpportunityClient id="d1" />);
    await waitFor(() => expect(screen.getByText(/couldn't load this opportunity/i)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    // No edit form rendered on error.
    expect(screen.queryByText("Edit opportunity")).not.toBeInTheDocument();
  });

  it("shows a not-found state when the opportunity does not exist", async () => {
    vi.mocked(op.getOpportunity).mockResolvedValue({ data: null, source: "api" });
    renderWithIntl(<EditOpportunityClient id="missing" />);
    await waitFor(() => expect(screen.getByText(/opportunity not found/i)).toBeInTheDocument());
  });
});
