/**
 * The OCR_DRIVER=external fetch must be bounded (CLOS3-S5-23): a hung endpoint or stalled body used to stall the
 * request/consumer forever. DB-free: only the OCR route plugin is mounted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

vi.mock("../src/shared/context.js", () => ({
  resolveContext: () => ({ tenantId: "t1", roles: ["hr_admin"] }),
  requireRole: () => undefined,
}));

import { documentOcrRoutes } from "../src/modules/ai-ml/document-ocr.js";

const ENV = ["OCR_DRIVER", "OCR_ENDPOINT", "OCR_TIMEOUT_MS"] as const;

describe("external OCR timeout", () => {
  const saved: Record<string, string | undefined> = {};
  let app: FastifyInstance;

  beforeEach(async () => {
    for (const k of ENV) saved[k] = process.env[k];
    process.env.OCR_DRIVER = "external";
    process.env.OCR_ENDPOINT = "http://ocr.invalid/extract";
    process.env.OCR_TIMEOUT_MS = "50";
    app = Fastify();
    await documentOcrRoutes(app);
  });
  afterEach(async () => {
    await app.close();
    vi.unstubAllGlobals();
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const hangUntilAborted = (signal: AbortSignal | undefined) =>
    new Promise<never>((_res, rej) => signal?.addEventListener("abort", () => rej(signal.reason)));

  it("a hung OCR endpoint yields the empty low-confidence result instead of hanging", async () => {
    vi.stubGlobal("fetch", (_u: unknown, init?: RequestInit) => hangUntilAborted(init?.signal ?? undefined));
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/ai/ocr/extract",
      payload: { imageKey: "uploads/a.jpg", documentType: "receipt" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ confidence: 0, autoFillReady: false, rawText: "" });
  }, 5000);

  it("a stalled response body is bounded by the same timeout", async () => {
    vi.stubGlobal("fetch", async (_u: unknown, init?: RequestInit) => ({
      ok: true, json: () => hangUntilAborted(init?.signal ?? undefined),
    }));
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/ai/ocr/extract",
      payload: { imageKey: "uploads/a.jpg", documentType: "receipt" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.confidence).toBe(0);
  }, 5000);

  it("in a batch, one hung document does not stall the others", async () => {
    vi.stubGlobal("fetch", async (_u: unknown, init?: RequestInit) => {
      const { imageKey } = JSON.parse(String(init?.body)) as { imageKey: string };
      if (imageKey === "hung") return hangUntilAborted(init?.signal ?? undefined);
      return { ok: true, json: async () => ({ rawText: "ok", confidence: 90, structured: {}, language: "eng" }) };
    });
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/ai/ocr/batch",
      payload: { documents: [
        { imageKey: "hung", documentType: "receipt" },
        { imageKey: "good", documentType: "receipt" },
      ] },
    });
    expect(res.statusCode).toBe(200);
    const byKey = Object.fromEntries((res.json().data as Array<{ imageKey: string; confidence: number }>).map((d) => [d.imageKey, d.confidence]));
    expect(byKey).toEqual({ hung: 0, good: 90 });
  }, 5000);

  it("non-timeout network errors still propagate (unchanged behaviour)", async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("fetch failed"); });
    const res = await app.inject({
      method: "POST", url: "/v1/hrms/ai/ocr/extract",
      payload: { imageKey: "uploads/a.jpg", documentType: "receipt" },
    });
    expect(res.statusCode).toBe(500);
  });

  it("the request carries an abort signal", async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal("fetch", async (_u: unknown, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return { ok: true, json: async () => ({ rawText: "", confidence: 70, structured: {}, language: "eng" }) };
    });
    await app.inject({ method: "POST", url: "/v1/hrms/ai/ocr/extract", payload: { imageKey: "k", documentType: "receipt" } });
    expect(seen).toBeInstanceOf(AbortSignal);
  });
});
