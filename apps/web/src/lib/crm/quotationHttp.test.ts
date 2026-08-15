import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as qp from "./quotation";

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

const product: qp.Product = { category: "c", code: "P1", name: "P", unit: "each", taxRateBps: 1800, priceMinor: "1000", currency: "INR", activeFrom: "", activeTo: "", enabled: true };

describe("quotation HTTP client (QP-001..005)", () => {
  it("product loaders + CRUD", async () => {
    fetchMock.mockResolvedValueOnce(res({ products: [product] }));
    expect((await qp.getProducts()).data).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(res({}, { status: 500 }));
    expect((await qp.getProducts()).source).toBe("error");
    fetchMock.mockResolvedValueOnce(res({ id: "p1" }, { status: 201 }));
    await expect(qp.createProduct(product)).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res({}));
    await expect(qp.updateProduct("p1", product)).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res({}, { status: 200 }));
    await expect(qp.deleteProduct("p1")).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res({ code: "E", message: "m" }, { status: 400 }));
    await expect(qp.createProduct(product)).rejects.toThrow(/E/);
  });

  it("price-book loaders, CRUD and resolve", async () => {
    fetchMock.mockResolvedValueOnce(res([{ id: "b1", name: "Gov", entries: [] }]));
    expect((await qp.getPriceBooks()).data).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(res({ id: "b1" }, { status: 201 }));
    await expect(qp.createPriceBook({ name: "x", segment: "", currency: "INR", geography: "", channel: "", entries: [], enabled: true })).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res({}));
    await expect(qp.updatePriceBook("b1", { name: "x", segment: "", currency: "INR", geography: "", channel: "", entries: [], enabled: true })).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res({}, { status: 200 }));
    await expect(qp.deletePriceBook("b1")).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res({ priceBook: { id: "b1", name: "Gov", entries: [] } }));
    expect((await qp.resolvePriceBook({ segment: "government" })).data?.name).toBe("Gov");
    fetchMock.mockResolvedValueOnce(res({}, { status: 404 }));
    expect((await qp.resolvePriceBook({ segment: "x" })).source).toBe("error");
  });

  it("quotation loaders and mutations, incl. 422 APPROVAL_REQUIRED on send", async () => {
    fetchMock.mockResolvedValueOnce(res([{ id: "q1", lines: [] }]));
    expect((await qp.getQuotations()).data).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(res({ quotation: { id: "q1", lines: [] } }));
    expect((await qp.getQuotation("q1")).data?.id).toBe("q1");
    fetchMock.mockResolvedValueOnce(res({ id: "q1" }, { status: 201 }));
    await expect(qp.createQuotation({ template: "standard", version: 1, status: "draft", lines: [] })).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res({}));
    await expect(qp.updateQuotation("q1", { template: "standard", version: 1, status: "draft", lines: [] })).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res({ code: "APPROVAL_REQUIRED", message: "blocked" }, { status: 422 }));
    await expect(qp.sendQuotation("q1")).rejects.toBeInstanceOf(qp.ApprovalRequiredError);
    fetchMock.mockResolvedValueOnce(res({ code: "BAD", message: "x" }, { status: 400 }));
    await expect(qp.sendQuotation("q1")).rejects.toThrow(/BAD/);
  });

  it("accept/reject/new-version/convert + approvals + versions", async () => {
    fetchMock.mockResolvedValueOnce(res({}));
    await expect(qp.acceptQuotation("q1")).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res({}));
    await expect(qp.rejectQuotation("q1", "no")).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res({}));
    await expect(qp.newQuotationVersion("q1")).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res({}));
    await expect(qp.convertToOrder("q1")).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res({ approvals: [{ quotationId: "q1", type: "discount", reason: "big", status: "pending" }] }));
    expect((await qp.getApprovals("q1")).data).toHaveLength(1);
    fetchMock.mockResolvedValueOnce(res({ id: "a1" }, { status: 201 }));
    await expect(qp.requestApproval("q1", { type: "discount", reason: "big", amountBps: 1000 })).resolves.toBeUndefined();
    fetchMock.mockResolvedValueOnce(res({}));
    await expect(qp.approveApproval("q1", "a1")).resolves.toBeUndefined();
    // Versions are the list filtered by quoteRef — there is no /:id/versions
    // route, so this now asks by ref and the payload carries versionNumber.
    fetchMock.mockResolvedValueOnce(
      res({ data: [{ id: "v2", quoteRef: "QTN/2026/ABC", versionNumber: 2, status: "sent", totalMinor: "100" }] }),
    );
    expect((await qp.getQuotationVersions("QTN/2026/ABC")).data).toHaveLength(1);
  });

  it("decides an approval via /v1/crm/quotation-approvals/:id/decide", async () => {
    // approveApproval used to POST /v1/crm/quotations/:id/approvals/:aid/approve,
    // a path the service never exposed, so approving always 404'd.
    fetchMock.mockResolvedValueOnce(res({}, { status: 202 }));
    await qp.approveApproval("q1", "a1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("v1/crm/quotation-approvals/a1/decide");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ decision: "approve" });
  });

  it("creates a quotation in the service's shape, not the UI model", async () => {
    // The request schema needs quoteRef / templateRef / lineItems[].description;
    // posting the raw UI model (template, lines) was rejected with 400.
    fetchMock.mockResolvedValueOnce(res({}, { status: 202 }));
    await qp.createQuotation({
      template: "standard",
      version: 1,
      status: "draft",
      lines: [{ productId: "11111111-1111-4111-8111-111111111111", productName: "Server", quantity: 2, unitPriceMinor: "5000", taxRateBps: 1800 }],
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.templateRef).toBe("standard");
    expect(body.quoteRef).toMatch(/^QTN\//);
    expect(body).not.toHaveProperty("lines");
    expect(body.lineItems).toEqual([
      { productId: "11111111-1111-4111-8111-111111111111", description: "Server", quantity: 2, unitPriceMinor: "5000", taxRateBps: 1800 },
    ]);
  });

  it("saves an edit as a new version, since there is no update route", async () => {
    fetchMock.mockResolvedValueOnce(res({}, { status: 202 }));
    await qp.updateQuotation("q1", {
      id: "q1",
      quoteRef: "QTN/2026/ABC",
      template: "standard",
      version: 1,
      status: "draft",
      lines: [{ productId: "11111111-1111-4111-8111-111111111111", productName: "Server", quantity: 1, unitPriceMinor: "100", taxRateBps: 0 }],
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("v1/crm/quotations/q1/new-version");
    expect(init.method).toBe("POST");
  });
});
