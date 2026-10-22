/**
 * Contract tests: the helpdesk loaders are fed the REAL service response shapes
 * (copied from helpdesk-service catalogue/tickets routes), not shapes invented
 * by the web tests. Service-side counterparts: helpdesk-service
 * tests/catalogue-routes.test.ts ("web contract") and tests/ticket-payload-shapes.test.ts.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("./apiClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./apiClient")>()),
  // Run the loader's own mapResponse over the payload, like the real fetchJson does.
  fetchJson: async (_path: string, fallback: unknown, opts: { mapResponse: (p: unknown) => unknown }) => ({
    data: opts.mapResponse(PAYLOAD.current) ?? fallback,
    source: "api",
  }),
}));

const PAYLOAD: { current: unknown } = { current: null };

import { getServiceRequest, getInternalHelpdeskTicketById, getCatalogueOfferings } from "./loaders";

describe("getCatalogueOfferings — list rows carry olas (turnaround column)", () => {
  it("passes the service's per-row olas through", async () => {
    PAYLOAD.current = {
      data: [{
        id: "o1", name: "VPN access", category: "access", description: null, status: "active",
        slaPolicyId: null, approvalRequired: false, requestFormSchema: [], fulfilmentStages: [],
        defaultPriority: "Medium", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
        olas: [{ id: "l1", offeringId: "o1", name: "IT OLA", kind: "ola", provider: "IT", targetMinutes: 120 }],
      }],
      pagination: { hasMore: false, pageSize: 50 },
    };
    const res = await getCatalogueOfferings();
    expect(res.data[0]!.olas![0]!.targetMinutes).toBe(120);
  });
});

describe("getServiceRequest — service sends approvals + stageEvents", () => {
  const base = {
    id: "r1", offeringId: "o1", ticketId: "t1", requestedBy: "u1", status: "rejected", currentStage: null,
    slaStatus: "within_sla", responseDeadline: null, resolutionDeadline: null, breachEscalatedAt: null,
    formData: {}, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-02T00:00:00.000Z",
  };

  it("derives rejectionReason from the rejected approval comment and stageHistory from stageEvents", async () => {
    PAYLOAD.current = {
      data: {
        ...base,
        approvals: [
          { id: "a1", requestId: "r1", decision: "approved", decidedBy: "u2", comment: "ok", decidedAt: "2026-10-01T10:00:00.000Z" },
          { id: "a2", requestId: "r1", decision: "rejected", decidedBy: "u3", comment: "Budget not approved", decidedAt: "2026-10-02T10:00:00.000Z" },
        ],
        stageEvents: [
          { id: "e1", requestId: "r1", fromStage: null, toStage: "triage", actorId: "u1", note: "raised", at: "2026-10-01T09:00:00.000Z" },
          { id: "e2", requestId: "r1", fromStage: "triage", toStage: "provision", actorId: "u2", note: null, at: "2026-10-01T11:00:00.000Z" },
        ],
      },
    };
    const res = await getServiceRequest("r1");
    expect(res.data?.rejectionReason).toBe("Budget not approved");
    expect(res.data?.stageHistory).toEqual([
      { stage: "triage", enteredAt: "2026-10-01T09:00:00.000Z", note: "raised" },
      { stage: "provision", enteredAt: "2026-10-01T11:00:00.000Z", note: null },
    ]);
  });

  it("no rejection and no events -> null reason, empty history (no crash)", async () => {
    PAYLOAD.current = { data: { ...base, status: "pending_approval", approvals: [], stageEvents: [] } };
    const res = await getServiceRequest("r1");
    expect(res.data?.rejectionReason).toBeNull();
    expect(res.data?.stageHistory).toEqual([]);
  });
});

describe("getInternalHelpdeskTicketById — detail carries ticketNo/description/createdAt", () => {
  it("maps the real TicketView (flat, no data envelope)", async () => {
    PAYLOAD.current = {
      id: "t1", subject: "VPN down", priority: "High", status: "In Progress",
      dueDate: "2026-10-05T00:00:00.000Z", slaStatus: "within_sla", assignee: "u9",
      ticketNo: "CASE/2026-27/000001", createdAt: "2026-10-01T08:00:00.000Z", description: "Cannot connect since 9am",
    };
    const res = await getInternalHelpdeskTicketById("t1");
    expect(res.data).toMatchObject({
      ticketNo: "CASE/2026-27/000001", description: "Cannot connect since 9am",
      createdAt: "2026-10-01T08:00:00.000Z", status: "In Progress",
    });
  });
});
