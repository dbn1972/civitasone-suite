import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

import { AddRiskForm } from "./AddRiskForm";

describe("GAP-PROJECTS-DETAIL-RISKS-01 AddRiskForm", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("POSTs the risk to the proxy endpoint and refreshes on success", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "r1", status: "accepted" }), { status: 202 }),
    );
    render(<AddRiskForm projectId="p1" />);
    fireEvent.change(screen.getByLabelText("Risk title"), { target: { value: "Monsoon delay" } });
    fireEvent.change(screen.getByLabelText("Probability"), { target: { value: "high" } });
    fireEvent.change(screen.getByLabelText("Impact"), { target: { value: "critical" } });
    fireEvent.click(screen.getByText("Add risk"));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("/api/proxy/v1/projects/p1/risks");
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      title: "Monsoon delay",
      probability: "high",
      impact: "critical",
    });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("blocks submit and shows an error when the title is empty (client zod guard)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<AddRiskForm projectId="p1" />);
    fireEvent.click(screen.getByText("Add risk"));
    expect(await screen.findByText("Risk title is required")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
