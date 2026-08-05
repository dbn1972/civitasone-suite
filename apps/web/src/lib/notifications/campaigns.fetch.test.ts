import { describe, it, expect, vi, beforeEach } from "vitest";
import * as client from "@/lib/api/browserClient";
import {
  getCampaigns,
  getCampaign,
  getCampaignMetrics,
  getCampaignTemplates,
  getCampaignSegments,
  createCampaign,
  sendCampaign,
  cancelCampaign,
} from "./campaigns";

vi.mock("@/lib/api/browserClient", () => ({
  browserFetch: vi.fn(),
  errorMessageFromResponse: vi.fn(async () => "BOOM: it failed"),
}));

const bf = () => vi.mocked(client.browserFetch);

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
function fail(status = 500): Response {
  return { ok: false, status, json: async () => ({ code: "ERR", message: "nope" }) } as unknown as Response;
}

beforeEach(() => {
  bf().mockReset();
});

describe("campaign loaders (paths + error gating)", () => {
  it("getCampaigns hits notification/campaigns with limit/offset and returns total", async () => {
    bf().mockResolvedValue(
      ok({ campaigns: [{ id: "c1", name: "A", status: "draft" }], total: 1 }),
    );
    const r = await getCampaigns(25, 50);
    expect(bf()).toHaveBeenCalledWith("notification/campaigns?limit=25&offset=50");
    expect(r.source).toBe("api");
    expect(r.data).toHaveLength(1);
    expect(r.total).toBe(1);
  });

  it("getCampaigns returns source=error (empty, not fabricated) on a non-ok response", async () => {
    bf().mockResolvedValue(fail());
    const r = await getCampaigns();
    expect(r.source).toBe("error");
    expect(r.data).toEqual([]);
    expect(r.total).toBeUndefined();
  });

  it("getCampaigns returns source=error when the fetch throws", async () => {
    bf().mockRejectedValue(new Error("network"));
    const r = await getCampaigns();
    expect(r.source).toBe("error");
  });

  it("getCampaign fetches by id and unwraps a { data } envelope", async () => {
    bf().mockResolvedValue(ok({ data: { id: "c9", name: "Wrapped", status: "sent" } }));
    const r = await getCampaign("c9");
    expect(bf()).toHaveBeenCalledWith("notification/campaigns/c9");
    expect(r.data?.id).toBe("c9");
    expect(r.source).toBe("api");
  });

  it("getCampaign returns error on failure", async () => {
    bf().mockResolvedValue(fail(404));
    const r = await getCampaign("missing");
    expect(r).toEqual({ data: null, source: "error" });
  });

  it("getCampaignMetrics hits the /metrics sub-path and keeps roiBps null", async () => {
    bf().mockResolvedValue(ok({ campaignId: "c1", roiBps: null, actualCostMinor: "0" }));
    const r = await getCampaignMetrics("c1");
    expect(bf()).toHaveBeenCalledWith("notification/campaigns/c1/metrics");
    expect(r.data?.roiBps).toBeNull();
  });

  it("getCampaignMetrics returns error on throw", async () => {
    bf().mockRejectedValue(new Error("x"));
    expect((await getCampaignMetrics("c1")).source).toBe("error");
  });

  it("getCampaignTemplates reuses notification/templates", async () => {
    bf().mockResolvedValue(ok([{ id: "t1", name: "Welcome", channel: "email" }]));
    const r = await getCampaignTemplates();
    expect(bf()).toHaveBeenCalledWith("notification/templates");
    expect(r.data[0].id).toBe("t1");
  });

  it("getCampaignTemplates degrades to source=error on failure", async () => {
    bf().mockResolvedValue(fail());
    expect(await getCampaignTemplates()).toEqual({ data: [], source: "error" });
  });

  it("getCampaignSegments hits v1/segments and tolerates a { segments } wrapper", async () => {
    bf().mockResolvedValue(ok({ segments: [{ id: "s1", name: "VIP" }] }));
    const r = await getCampaignSegments();
    expect(bf()).toHaveBeenCalledWith("v1/segments");
    expect(r.data[0].name).toBe("VIP");
  });

  it("getCampaignSegments degrades to source=error when unreachable", async () => {
    bf().mockRejectedValue(new Error("no gateway route"));
    expect(await getCampaignSegments()).toEqual({ data: [], source: "error" });
  });
});

describe("campaign mutations", () => {
  it("createCampaign POSTs the body to notification/campaigns", async () => {
    bf().mockResolvedValue(ok({ id: "new" }));
    await createCampaign({ name: "X", templateId: "t1", recipients: ["a@x.in"], budgetMinor: "500000", currency: "INR" });
    expect(bf()).toHaveBeenCalledWith(
      "notification/campaigns",
      expect.objectContaining({ method: "POST" }),
    );
    const [, init] = bf().mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      name: "X",
      templateId: "t1",
      budgetMinor: "500000",
    });
  });

  it("createCampaign throws the server error message on failure", async () => {
    bf().mockResolvedValue(fail(422));
    await expect(createCampaign({ name: "X", templateId: "t1", recipients: ["a@x.in"] })).rejects.toThrow(/BOOM/);
  });

  it("sendCampaign PATCHes the /send sub-path", async () => {
    bf().mockResolvedValue(ok({}));
    await sendCampaign("c1");
    expect(bf()).toHaveBeenCalledWith("notification/campaigns/c1/send", { method: "PATCH" });
  });

  it("cancelCampaign PATCHes the /cancel sub-path", async () => {
    bf().mockResolvedValue(ok({}));
    await cancelCampaign("c1");
    expect(bf()).toHaveBeenCalledWith("notification/campaigns/c1/cancel", { method: "PATCH" });
  });

  it("sendCampaign throws on a non-ok response", async () => {
    bf().mockResolvedValue(fail());
    await expect(sendCampaign("c1")).rejects.toThrow(/BOOM/);
  });
});
