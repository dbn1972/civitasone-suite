import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import {
  FinanceVendorSummaryListSchema,
  FinanceBudgetAllocationSummaryListSchema,
  copilotTurnsListSchema,
  RoleDetailSchema,
} from "@civitasone/schemas/web";

const mockGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => ({ get: mockGet }),
}));

import { envelopePayload, fetchJson, parseWithEnvelope } from "./apiClient";
import { getArrayPayload } from "./apiMappers";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    clone() {
      return jsonResponse(status, body);
    },
  } as unknown as Response;
}

const rowSchema = z.object({ id: z.string(), name: z.string() });
const listSchema = z.array(rowSchema);
const rows = [{ id: "v1", name: "Vendor One" }, { id: "v2", name: "Vendor Two" }];

describe("envelopePayload (UAT-P1A-01)", () => {
  it("returns the payload of data / items envelopes", () => {
    expect(envelopePayload({ data: rows, meta: { total: 2 } })).toBe(rows);
    expect(envelopePayload({ data: rows, pagination: { hasMore: false } })).toBe(rows);
    expect(envelopePayload({ items: rows, total: 2, limit: 50, offset: 0 })).toBe(rows);
    const rec = { id: "r1" };
    expect(envelopePayload({ data: rec })).toBe(rec);
  });

  it("is undefined for anything that is not an envelope", () => {
    expect(envelopePayload(rows)).toBeUndefined();
    expect(envelopePayload({ id: "r1", name: "x" })).toBeUndefined();
    expect(envelopePayload({ data: null })).toBeUndefined();
    expect(envelopePayload(null)).toBeUndefined();
    expect(envelopePayload("text")).toBeUndefined();
  });
});

describe("parseWithEnvelope (UAT-P1A-01)", () => {
  it("validates a bare response as before", () => {
    expect(parseWithEnvelope(listSchema, rows)).toEqual({ success: true, data: rows });
  });

  it("accepts an enveloped list against a bare-array schema", () => {
    expect(parseWithEnvelope(listSchema, { data: rows, meta: { page: 1, pageSize: 50, total: 2 } })).toEqual({ success: true, data: rows });
    expect(parseWithEnvelope(listSchema, { items: rows, total: 2 })).toEqual({ success: true, data: rows });
  });

  it("prefers the schema's own reading when the schema models the envelope", () => {
    const envSchema = z.object({ data: listSchema, meta: z.object({ total: z.number() }) });
    const body = { data: rows, meta: { total: 2 } };
    expect(parseWithEnvelope(envSchema, body)).toEqual({ success: true, data: body });
  });

  it("still rejects a field-level mismatch inside the envelope", () => {
    expect(parseWithEnvelope(listSchema, { data: [{ id: "v1" }] }).success).toBe(false);
    expect(parseWithEnvelope(listSchema, { data: { id: "v1", name: "x" } }).success).toBe(false);
  });
});

describe("fetchJson with an enveloped response (UAT-P1A-01)", () => {
  beforeEach(() => {
    mockGet.mockReturnValue({ value: "fake-access-token" });
    process.env.CIVITASONE_API_BASE_URL = "http://gateway.test";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CIVITASONE_API_BASE_URL;
  });

  // The recon D03/D04 case: 200 with data, yet the screen said "We couldn't load ...".
  it("loads a {data, meta} list whose loader schema is z.array(...)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { data: rows, meta: { page: 1, pageSize: 50, total: 2 } })));
    const result = await fetchJson<unknown, unknown[]>("/api/v1/finance/vendors", [], {
      telemetryKey: "test.envelope",
      responseSchema: listSchema,
      mapResponse: (p) => getArrayPayload(p),
    });
    expect(result).toEqual({ data: rows, source: "api" });
  });

  it("loads an {items, total} list (audit-service shape)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { items: rows, total: 2, limit: 50, offset: 0 })));
    const result = await fetchJson<unknown, unknown[]>("/api/v1/audit/vigilance", [], {
      telemetryKey: "test.items",
      responseSchema: listSchema,
      mapResponse: (p) => getArrayPayload(p),
    });
    expect(result).toEqual({ data: rows, source: "api" });
  });

  it("an envelope whose rows break the schema is still an error, not silent data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ id: 1 }] })));
    const result = await fetchJson<unknown, unknown[]>("/x", [], {
      telemetryKey: "test.bad",
      responseSchema: listSchema,
      mapResponse: (p) => getArrayPayload(p),
    });
    expect(result).toEqual({ data: [], source: "error", status: 200 });
  });

  it("without a schema, a record mapper gets the {data: {...}} payload when it rejects the envelope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { data: { id: "v1", name: "Vendor One" } })));
    const result = await fetchJson<unknown, { id: string } | null>("/api/v1/procurement/vendors/v1", null, {
      telemetryKey: "test.record",
      mapResponse: (p) => {
        const r = p as { id?: unknown; name?: unknown };
        return typeof r.id === "string" && typeof r.name === "string" ? { id: r.id } : null;
      },
    });
    expect(result).toEqual({ data: { id: "v1" }, source: "api" });
  });

  it("without a schema, a mapper that accepts the envelope is called once with it", async () => {
    const body = { data: rows };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, body)));
    const mapResponse = vi.fn((p: unknown) => getArrayPayload(p));
    const result = await fetchJson<unknown, unknown[] | null>("/x", [], { telemetryKey: "test.once", mapResponse });
    expect(result).toEqual({ data: rows, source: "api" });
    expect(mapResponse).toHaveBeenCalledTimes(1);
    expect(mapResponse).toHaveBeenCalledWith(body);
  });
});

// Real response shapes captured from UAT (GET via the gateway, 3 Nov), trimmed.
describe("loader schemas accept the live API envelopes (UAT-P1A-01)", () => {
  it("finance vendors {data, meta}", () => {
    const row = { id: "0d3c7f91-9ede-4a22-bbe2-840bb8478c1d", name: "Vendor-QHY8EL", category: "goods", pan: "AAAAA0000A", gstin: null, status: "active", ratingDisplay: "—" };
    const body = { data: [row], meta: { page: 1, pageSize: 50, total: 1 } };
    expect(FinanceVendorSummaryListSchema.safeParse(body).success).toBe(false);
    expect(parseWithEnvelope(FinanceVendorSummaryListSchema, body)).toEqual({ success: true, data: [row] });
  });

  it("budget allocations {data}", () => {
    const body = { data: [] };
    expect(FinanceBudgetAllocationSummaryListSchema.safeParse(body).success).toBe(false);
    expect(parseWithEnvelope(FinanceBudgetAllocationSummaryListSchema, body)).toEqual({ success: true, data: [] });
  });

  it("copilot turns keep their envelope (schema models it) and tolerate null citation fields", () => {
    const body = {
      data: [{
        id: "5b0f3c1e-8a8d-4e0e-9a51-0d0c8a1e2f3a", userId: null, prompt: "q", response: "a",
        sourceCitations: [{ id: "c1", title: "Doc", url: null, score: null }],
        model: null, tokens: null, latencyMs: null, createdAt: "2026-11-02T10:00:00Z", version: 1,
      }],
      meta: { page: 1, pageSize: 50, total: 1 },
    };
    const parsed = parseWithEnvelope(copilotTurnsListSchema, body);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.data[0].sourceCitations?.[0]).toEqual({ id: "c1", title: "Doc", url: undefined, score: undefined });
  });

  it("role detail without createdAt (policy-service shape)", () => {
    const body = { id: "055940b4-cd49-48e5-86bc-34108364d692", tenantId: "t", name: "auditor", description: "Auditor", status: "active", version: 1 };
    expect(RoleDetailSchema.safeParse(body).success).toBe(true);
  });
});
