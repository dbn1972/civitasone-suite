/**
 * document-scan OCR adapter on top of @civitasone/ocr: behaviour preserved after the migration
 * (eng+hin local OCR, empty extraction on failure, cloud-first with the inline circuit breaker).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const recognize = vi.fn();
const ctor = vi.fn();
vi.mock("@civitasone/ocr", () => ({
  TesseractProvider: class {
    constructor(cfg: unknown) { ctor(cfg); }
    recognize = recognize;
  },
  toPageImage: async (data: Uint8Array) => ({ pageNumber: 1, data, mimeType: "image/png", width: 10, height: 10, dpi: 300 }),
}));

import { getCircuitState, performOcr, resetCircuitBreaker } from "../src/modules/document-scan/ocr-adapter.js";

const SAMPLE = "RAMESH KUMAR\n12/03/1985\n1234 5678 9012\nNew Delhi 110001\nIndia";

describe("document-scan ocr-adapter (@civitasone/ocr migration)", () => {
  const env = { ...process.env };
  beforeEach(() => {
    resetCircuitBreaker();
    recognize.mockReset();
    delete process.env.OCR_PROVIDER;
    delete process.env.OCR_CLOUD_URL;
    delete process.env.OCR_CLOUD_API_KEY;
  });
  afterEach(() => { process.env = { ...env }; vi.unstubAllGlobals(); });

  it("local path: recognises with eng+hin and parses the structured fields", async () => {
    recognize.mockResolvedValue([{ text: SAMPLE }]);
    const out = await performOcr(Buffer.from([1, 2, 3]));
    expect(recognize).toHaveBeenCalledTimes(1);
    expect(recognize.mock.calls[0]?.[1]).toEqual({ langs: ["eng", "hin"] });
    expect(out.fullName).toBe("RAMESH KUMAR");
    expect(out.dateOfBirth).toBe("12/03/1985");
    expect(out.idDocumentNumber).toBe("123456789012");
    expect(out.confidenceScores.date_of_birth).toBe(70);
  });

  it("returns an empty extraction when local OCR fails (no throw)", async () => {
    recognize.mockRejectedValue(new Error("traineddata missing"));
    const out = await performOcr(Buffer.from([1]));
    expect(out).toEqual({ fullName: null, dateOfBirth: null, idDocumentNumber: null, idDocumentType: null, address: null, photoRegionKey: null, confidenceScores: {} });
  });

  it("cloud failures fall back to local OCR and trip the breaker after 5 failures in the window", async () => {
    process.env.OCR_PROVIDER = "cloud";
    process.env.OCR_CLOUD_URL = "https://ocr.example.invalid/x";
    process.env.OCR_CLOUD_API_KEY = "test-key"; // gitleaks:allow
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    recognize.mockResolvedValue([{ text: SAMPLE }]);
    for (let i = 0; i < 5; i++) await performOcr(Buffer.from([1]));
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(getCircuitState()).toEqual({ state: "open", failures: 5 });
    const out = await performOcr(Buffer.from([1]));
    expect(fetchMock).toHaveBeenCalledTimes(5); // circuit open: cloud skipped
    expect(out.fullName).toBe("RAMESH KUMAR");
    resetCircuitBreaker();
    expect(getCircuitState()).toEqual({ state: "closed", failures: 0 });
  });

  it("a healthy cloud response is mapped without touching local OCR", async () => {
    process.env.OCR_PROVIDER = "cloud";
    process.env.OCR_CLOUD_URL = "https://ocr.example.invalid/x";
    process.env.OCR_CLOUD_API_KEY = "test-key"; // gitleaks:allow
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ fields: { full_name: "A B", dob: "01/01/1990" } }) }));
    const out = await performOcr(Buffer.from([1]));
    expect(out.fullName).toBe("A B");
    expect(out.dateOfBirth).toBe("01/01/1990");
    expect(recognize).not.toHaveBeenCalled();
  });
});
