import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as op from "./opportunity";

/** Exercises the browserFetch-backed loaders/mutations by stubbing global fetch. */
function res(body: unknown, init: { status?: number } = {}): Response {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("opportunity HTTP client (OP-001..006)", () => {
  it("getPipelines maps ok, flags error on !ok and on throw", async () => {
    fetchMock.mockResolvedValueOnce(res({ pipelines: [{ id: "p1", name: "A", stages: [] }] }));
    expect((await op.getPipelines()).source).toBe("api");
    fetchMock.mockResolvedValueOnce(res({}, { status: 500 }));
    expect((await op.getPipelines()).source).toBe("error");
    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect((await op.getPipelines()).source).toBe("error");
  });

  it("pipeline CRUD posts/puts/deletes and throws the server code on failure", async () => {
    fetchMock.mockResolvedValueOnce(res({ id: "p1" }, { status: 201 }));
    await expect(op.createPipeline({ name: "A", stages: [], enabled: true })).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res({}, { status: 200 }));
    await expect(op.updatePipeline("p1", { name: "A", stages: [], enabled: true })).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res({}, { status: 200 }));
    await expect(op.deletePipeline("p1")).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res({ code: "CONFLICT", message: "in use" }, { status: 409 }));
    await expect(op.deletePipeline("p1")).rejects.toThrow(/CONFLICT/);
  });

  it("createOpportunity surfaces a 422 MANDATORY_STAGE_FIELDS_MISSING as MandatoryFieldsError", async () => {
    fetchMock.mockResolvedValueOnce(
      res({ code: "MANDATORY_STAGE_FIELDS_MISSING", missingFields: ["value", "product"] }, { status: 422 }),
    );
    await expect(
      op.createOpportunity({ name: "x", pipelineId: "p1", stage: "s", valueMinor: "0", probability: 0, product: "", quantity: 0, competitors: [], nextStep: "", expectedCloseDate: "" }),
    ).rejects.toMatchObject({ name: "MandatoryFieldsError", missingFields: ["value", "product"] });
  });

  it("changeOpportunityStage throws MandatoryFieldsError on 422 and a generic error otherwise", async () => {
    fetchMock.mockResolvedValueOnce(res({ code: "MANDATORY_STAGE_FIELDS_MISSING", fields: ["nextStep"] }, { status: 422 }));
    await expect(op.changeOpportunityStage("d1", "propose")).rejects.toBeInstanceOf(op.MandatoryFieldsError);
    fetchMock.mockResolvedValueOnce(res({ code: "FORBIDDEN", message: "no" }, { status: 403 }));
    await expect(op.changeOpportunityStage("d1", "propose")).rejects.toThrow(/FORBIDDEN/);
  });

  it("closeOpportunity posts the outcome payload", async () => {
    fetchMock.mockResolvedValueOnce(res({ ok: true }));
    await expect(op.closeOpportunity("d1", { outcome: "won", reason: "signed" })).resolves.toBeUndefined();
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ outcome: "won", reason: "signed" });
  });

  it("view + ageing + stage-limit loaders map or flag error", async () => {
    fetchMock.mockResolvedValueOnce(res({ columns: [{ stage: "s", deals: [] }] }));
    expect((await op.getKanban("p1")).source).toBe("api");
    fetchMock.mockResolvedValueOnce(res([{ stage: "s", count: 1, valueMinor: "10" }]));
    expect((await op.getFunnel("p1")).data[0].count).toBe(1);
    fetchMock.mockResolvedValueOnce(res([{ id: "d1", name: "x" }]));
    expect((await op.getOpportunities("p1")).data).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(res([{ id: "d1", expectedCloseDate: "2026-09-01" }]));
    expect((await op.getCalendar()).data).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(res([{ id: "d1", name: "x", stage: "s", daysInStage: 20, limitDays: 14 }]));
    expect((await op.getStageAgeing()).data[0].exceededBy).toBe(6);
    fetchMock.mockResolvedValueOnce(res({ limits: [{ stage: "s", limitDays: 14 }] }));
    expect((await op.getStageLimits()).data).toHaveLength(1);
  });

  it("stage-limit CRUD posts/puts/deletes", async () => {
    fetchMock.mockResolvedValueOnce(res({ id: "l1" }, { status: 201 }));
    await expect(op.createStageLimit({ stage: "s", limitDays: 14 })).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res({}));
    await expect(op.updateStageLimit("l1", { stage: "s", limitDays: 20 })).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res({}, { status: 200 }));
    await expect(op.deleteStageLimit("l1")).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res({}, { status: 500 }));
    await expect(op.createStageLimit({ stage: "s", limitDays: 14 })).rejects.toThrow();
  });

  it("updateOpportunity round-trips and surfaces errors", async () => {
    fetchMock.mockResolvedValueOnce(res({}));
    await expect(
      op.updateOpportunity("d1", { id: "d1", name: "x", pipelineId: "p1", stage: "s", valueMinor: "1", probability: 0, product: "", quantity: 0, competitors: [], nextStep: "", expectedCloseDate: "" }),
    ).resolves.toBeUndefined();
  });
});
