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
    fetchMock.mockResolvedValueOnce(res({ versions: [{ version: 2, status: "sent", totalMinor: "100" }] }));
    expect((await qp.getQuotationVersions("q1")).data).toHaveLength(1);
  });
});
