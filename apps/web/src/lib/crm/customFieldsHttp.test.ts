import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as cf from "./customFields";

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

const raw = {
  id: "f1",
  tenantId: "t1",
  entityType: "leads",
  fieldName: "Region",
  fieldType: "select",
  validationSchema: { required: true, options: ["North", "South"] },
  ordinal: 2,
  version: 1,
  createdAt: "2026-05-01T09:00:00Z",
  updatedAt: "2026-05-01T09:00:00Z",
};

describe("customFields pure helpers", () => {
  it("normalises the { data, meta } list wrapper, sorts by ordinal, drops junk", () => {
    const fields = cf.normaliseCustomFields({
      data: [
        { ...raw, id: "b", ordinal: 5 },
        { ...raw, id: "a", ordinal: 1 },
        { id: "" }, // no id -> dropped
        { id: "x", entityType: "nope", fieldType: "text" }, // bad enum -> dropped
      ],
      meta: {},
    });
    expect(fields.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("tolerates a bare array and snake_case", () => {
    const fields = cf.normaliseCustomFields([
      { id: "s", entity_type: "contacts", field_name: "PAN", field_type: "text", ordinal: 0 },
    ]);
    expect(fields[0]).toMatchObject({ id: "s", entityType: "contacts", fieldName: "PAN", fieldType: "text" });
  });

  it("reads required + options out of validationSchema and back into a draft", () => {
    const field = cf.normaliseCustomField(raw)!;
    const draft = cf.toDraft(field);
    expect(draft.required).toBe(true);
    expect(draft.options).toEqual(["North", "South"]);
    expect(cf.fieldTypeHasOptions(draft.fieldType)).toBe(true);
  });

  it("validateDraft: fieldName required + select needs an option", () => {
    expect(cf.validateDraft(cf.blankDraft("leads")).fieldName).toBeTruthy();
    const sel = { ...cf.blankDraft("leads"), fieldName: "Region", fieldType: "select" as const, options: [] };
    expect(cf.validateDraft(sel).options).toBeTruthy();
    expect(cf.isDraftValid(sel)).toBe(false);
    const ok = { ...sel, options: ["North"] };
    expect(cf.isDraftValid(ok)).toBe(true);
    const tooLong = { ...cf.blankDraft("leads"), fieldName: "x".repeat(65) };
    expect(cf.validateDraft(tooLong).fieldName).toBeTruthy();
  });

  it("buildValidationSchema keeps options only for option types and null when empty", () => {
    expect(cf.buildValidationSchema(cf.blankDraft("leads"))).toBeNull();
    const t = { ...cf.blankDraft("leads"), fieldName: "n", fieldType: "text" as const, required: true, options: ["ignored"] };
    expect(cf.buildValidationSchema(t)).toEqual({ required: true });
    const s = { ...cf.blankDraft("leads"), fieldName: "n", fieldType: "select" as const, options: ["A", " ", "B"] };
    expect(cf.buildValidationSchema(s)).toEqual({ options: ["A", "B"] });
  });
});

describe("customFields HTTP client", () => {
  it("listCustomFields hits the entity endpoint and gates errors", async () => {
    fetchMock.mockResolvedValueOnce(res({ data: [raw], meta: {} }));
    const a = await cf.listCustomFields("leads");
    expect(a.source).toBe("api");
    expect(a.data).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/proxy/v1/crm/custom-fields/leads");

    fetchMock.mockResolvedValueOnce(res({}, { status: 500 }));
    const e = await cf.listCustomFields("leads");
    expect(e.source).toBe("error");
    expect(e.data).toEqual([]);

    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect((await cf.listCustomFields("leads")).source).toBe("error");
  });

  it("getCustomField unwraps { data } and gates errors", async () => {
    fetchMock.mockResolvedValueOnce(res({ data: raw }));
    const a = await cf.getCustomField("f1");
    expect(a.source).toBe("api");
    expect(a.data?.id).toBe("f1");

    fetchMock.mockResolvedValueOnce(res({}, { status: 404 }));
    const e = await cf.getCustomField("f1");
    expect(e.source).toBe("error");
    expect(e.data).toBeNull();
  });

  it("createCustomField POSTs the mapped body", async () => {
    fetchMock.mockResolvedValueOnce(res({ accepted: true }, { status: 202 }));
    await cf.createCustomField({
      entityType: "deals", fieldName: "  Priority  ", fieldType: "select", required: true, options: ["Hi", ""], ordinal: 3,
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/crm/custom-fields");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      entityType: "deals", fieldName: "Priority", fieldType: "select", ordinal: 3,
      validationSchema: { required: true, options: ["Hi"] },
    });
  });

  it("createCustomField throws the server error message", async () => {
    fetchMock.mockResolvedValueOnce(res({ code: "CUSTOM_FIELD_LIMIT_REACHED", message: "too many" }, { status: 422 }));
    await expect(
      cf.createCustomField({ ...cf.blankDraft("leads"), fieldName: "n" }),
    ).rejects.toThrow(/CUSTOM_FIELD_LIMIT_REACHED/);
  });

  it("updateCustomField PATCHes and deleteCustomField DELETEs by id", async () => {
    fetchMock.mockResolvedValueOnce(res({ accepted: true }, { status: 202 }));
    await cf.updateCustomField("f1", { ...cf.blankDraft("leads"), fieldName: "n", ordinal: 4 });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/proxy/v1/crm/custom-fields/f1");
    expect(fetchMock.mock.calls[0][1].method).toBe("PATCH");

    fetchMock.mockResolvedValueOnce(res({ accepted: true }, { status: 202 }));
    await cf.deleteCustomField("f1");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/proxy/v1/crm/custom-fields/f1");
    expect(fetchMock.mock.calls[1][1].method).toBe("DELETE");
  });
});
