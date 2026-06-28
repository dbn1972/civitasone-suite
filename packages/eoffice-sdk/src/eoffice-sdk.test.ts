import { describe, it, expect, vi } from "vitest";
import { EOfficeClient, EOfficeError } from "./client.js";
import {
  SOURCE_REF_TYPES,
  MODULE_CALLBACK_TOPICS,
  decisionCallbackPayload,
} from "./contracts.js";
import { callbackTopicFor, callbackTopicsFor, parseDecisionCallback } from "./callbacks.js";

const REF_ID = "11111111-1111-1111-1111-111111111111";
const OFFICER = "22222222-2222-2222-2222-222222222222";
const APPROVER = "33333333-3333-3333-3333-333333333333";

function mockFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

describe("contract integrity", () => {
  it("has a callback topic for every source ref type", () => {
    for (const t of SOURCE_REF_TYPES) {
      expect(MODULE_CALLBACK_TOPICS[t]).toBeTruthy();
    }
  });

  it("callbackTopicsFor dedupes", () => {
    const topics = callbackTopicsFor(["finance_sanction", "finance_sanction", "hr_transfer"]);
    expect(topics).toHaveLength(2);
    expect(topics).toContain(callbackTopicFor("hr_transfer"));
  });
});

describe("EOfficeClient.raiseFile", () => {
  it("posts and parses the accepted result", async () => {
    const fetchImpl = mockFetch(202, {
      id: REF_ID,
      fileNo: "FIN/2026/1234",
      status: "accepted",
      correlationId: "corr-1",
    });
    const client = new EOfficeClient({ baseUrl: "http://estab", token: "t", fetchImpl });
    const res = await client.raiseFile({
      refType: "finance_sanction",
      refId: REF_ID,
      subject: "Sanction for road works",
      dept: "PWD",
      initiatedBy: OFFICER,
      currentWith: APPROVER,
      approvalChain: "finance.sanction.standard",
      initialNote: "Proposal for approval",
    });
    expect(res.fileNo).toBe("FIN/2026/1234");
  });

  it("rejects invalid input before calling the network", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const client = new EOfficeClient({ baseUrl: "http://estab", token: "t", fetchImpl });
    await expect(
      client.raiseFile({
        // @ts-expect-error invalid refType
        refType: "not_a_type",
        refId: REF_ID,
        subject: "x",
        dept: "PWD",
        initiatedBy: OFFICER,
        currentWith: APPROVER,
        approvalChain: "c",
        initialNote: "n",
      }),
    ).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps non-2xx into EOfficeError", async () => {
    const fetchImpl = mockFetch(400, { code: "VALIDATION_FAILED", message: "bad" });
    const client = new EOfficeClient({ baseUrl: "http://estab", token: "t", fetchImpl });
    await expect(
      client.raiseFile({
        refType: "hr_transfer",
        refId: REF_ID,
        subject: "Transfer order",
        dept: "HR",
        initiatedBy: OFFICER,
        currentWith: APPROVER,
        approvalChain: "hr.transfer.standard",
        initialNote: "note",
      }),
    ).rejects.toBeInstanceOf(EOfficeError);
  });
});

describe("EOfficeClient.getFileByRef", () => {
  it("returns null on 404", async () => {
    const fetchImpl = mockFetch(404, { code: "NOT_FOUND", message: "no file" });
    const client = new EOfficeClient({ baseUrl: "http://estab", token: "t", fetchImpl });
    const res = await client.getFileByRef("grant_scheme", REF_ID);
    expect(res).toBeNull();
  });
});

describe("EOfficeClient.resolveApprovalChain", () => {
  it("returns null when the matrix has no match", async () => {
    const fetchImpl = mockFetch(200, { data: null });
    const client = new EOfficeClient({ baseUrl: "http://estab", token: "t", fetchImpl });
    expect(await client.resolveApprovalChain("finance_sanction", 1000)).toBeNull();
  });

  it("parses a resolved approval", async () => {
    const fetchImpl = mockFetch(200, {
      data: {
        ruleId: "r1",
        label: "PO 5L–50L",
        workflowDefinitionCode: "wf.director_cto",
        startNodeKey: "review",
        steps: [{ role: "director", label: "Director" }],
      },
    });
    const client = new EOfficeClient({ baseUrl: "http://estab", token: "t", fetchImpl });
    const r = await client.resolveApprovalChain("finance_sanction", 1_000_000_00);
    expect(r?.workflowDefinitionCode).toBe("wf.director_cto");
  });
});

describe("parseDecisionCallback", () => {
  it("accepts a valid payload", () => {
    const r = parseDecisionCallback({
      fileId: REF_ID,
      fileNo: "FIN/2026/1",
      refType: "finance_sanction",
      refId: REF_ID,
      decision: "approved",
      decidedBy: OFFICER,
      decidedAt: new Date().toISOString(),
    });
    expect(r.ok).toBe(true);
  });

  it("rejects an unknown decision", () => {
    const r = parseDecisionCallback({
      fileId: REF_ID,
      fileNo: "FIN/2026/1",
      refType: "finance_sanction",
      refId: REF_ID,
      decision: "maybe",
      decidedBy: OFFICER,
      decidedAt: new Date().toISOString(),
    });
    expect(r.ok).toBe(false);
  });

  it("schema is exported for consumers", () => {
    expect(decisionCallbackPayload).toBeDefined();
  });
});
