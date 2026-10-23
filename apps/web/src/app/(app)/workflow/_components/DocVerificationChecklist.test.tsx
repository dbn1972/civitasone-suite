import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DocVerificationChecklist } from "./DocVerificationChecklist";

describe("DocVerificationChecklist (GAP-WORKFLOW-INSTANCES-DETAIL-02)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("shows a visible indicator and Retry in compact mode on error (not null)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 500 }) as unknown as Response);
    const onState = vi.fn();
    render(<DocVerificationChecklist laneKey="inspection" applicationId="app-1" compact onState={onState} />);
    await waitFor(() => expect(screen.getByText("Docs: unavailable")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Retry document checklist" })).toBeInTheDocument();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ status: "error" })));
  });

  it("reports missing mandatory docs via onState and shows a summary chip", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{
          laneKey: "inspection", serviceId: null, applicationId: "app-missing", ok: true,
          items: [
            { docType: "pan", label: "PAN", mandatory: true, provided: false, verified: false },
            { docType: "photo", label: "Photo", mandatory: false, provided: true, verified: true },
          ],
        }] }),
        { status: 200 },
      ) as unknown as Response,
    );
    const onState = vi.fn();
    render(<DocVerificationChecklist laneKey="inspection" applicationId="app-missing" onState={onState} />);
    await waitFor(() => expect(screen.getByText("1 mandatory missing")).toBeInTheDocument());
    await waitFor(() => expect(onState).toHaveBeenCalledWith({ status: "ready", missingMandatory: 1 }));
  });

  it("sends ONE batched request for every checklist mounted together (no per-row GET)", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
      const lanes = (JSON.parse(String((init as RequestInit).body)) as { lanes: Array<{ laneKey: string; applicationId: string }> }).lanes;
      return new Response(JSON.stringify({
        data: lanes.map((l) => ({ laneKey: l.laneKey, serviceId: null, applicationId: l.applicationId, ok: true, items: [
          { docType: "pan", label: `PAN ${l.applicationId}`, mandatory: false, provided: true, verified: true },
        ] })),
      }), { status: 200 }) as unknown as Response;
    });
    render(
      <>
        <DocVerificationChecklist laneKey="inspection" applicationId="batch-a" />
        <DocVerificationChecklist laneKey="inspection" applicationId="batch-b" />
        <DocVerificationChecklist laneKey="inspection" applicationId="batch-c" />
      </>,
    );
    await waitFor(() => expect(screen.getByText("PAN batch-c", { exact: false })).toBeInTheDocument());
    expect(screen.getByText("PAN batch-a", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("PAN batch-b", { exact: false })).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe("/api/proxy/v1/citizen/documents/verification-lane/batch");
    expect((init as RequestInit).method).toBe("POST");
    const lanes = (JSON.parse(String((init as RequestInit).body)) as { lanes: unknown[] }).lanes;
    expect(lanes).toHaveLength(3);
  });

  it("a lane the service could not answer shows the unavailable state without failing its neighbours", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [
      { laneKey: "inspection", serviceId: null, applicationId: "ok-row", ok: true, items: [{ docType: "pan", label: "PAN ok-row", mandatory: false, provided: true, verified: true }] },
      { laneKey: "inspection", serviceId: null, applicationId: "bad-row", ok: false, items: [] },
    ] }), { status: 200 }) as unknown as Response);
    render(
      <>
        <DocVerificationChecklist laneKey="inspection" applicationId="ok-row" compact />
        <DocVerificationChecklist laneKey="inspection" applicationId="bad-row" compact />
      </>,
    );
    await waitFor(() => expect(screen.getByText("Docs: unavailable")).toBeInTheDocument());
    expect(screen.getByText("PAN ok-row", { exact: false })).toBeInTheDocument();
  });
});
