/**
 * Tests for exports/domain.ts — CSV/JSON generation and 50MB size enforcement.
 */
import { describe, it, expect } from "vitest";
import {
  generateExport,
  buildFileKey,
  computeExpiresAt,
  ExportSizeLimitExceededError,
  MAX_EXPORT_SIZE_BYTES,
  PRESIGNED_URL_TTL_SECONDS,
} from "../src/modules/exports/domain.js";

describe("exports/domain — generateExport", () => {
  describe("CSV format", () => {
    it("generates valid CSV from array of objects", () => {
      const data = [
        { name: "Alice", amount: 1000, city: "Mumbai" },
        { name: "Bob", amount: 2000, city: "Delhi" },
      ];
      const result = generateExport(data, "csv");

      expect(result.contentType).toBe("text/csv; charset=utf-8");
      const csv = result.content.toString("utf-8");
      const lines = csv.split("\n");
      expect(lines[0]).toBe("name,amount,city");
      expect(lines[1]).toBe("Alice,1000,Mumbai");
      expect(lines[2]).toBe("Bob,2000,Delhi");
      expect(result.sizeBytes).toBe(Buffer.byteLength(csv, "utf-8"));
    });

    it("handles { rows: [...] } shaped results", () => {
      const data = { rows: [{ id: "1", value: 42 }] };
      const result = generateExport(data, "csv");
      const csv = result.content.toString("utf-8");
      expect(csv).toContain("id,value");
      expect(csv).toContain("1,42");
    });

    it("handles { data: [...] } shaped results", () => {
      const data = { data: [{ col: "test" }] };
      const result = generateExport(data, "csv");
      const csv = result.content.toString("utf-8");
      expect(csv).toContain("col");
      expect(csv).toContain("test");
    });

    it("produces empty content for empty array", () => {
      const result = generateExport([], "csv");
      expect(result.content.toString("utf-8")).toBe("");
      expect(result.sizeBytes).toBe(0);
    });

    it("escapes fields containing commas", () => {
      const data = [{ description: "Hello, World", value: 10 }];
      const result = generateExport(data, "csv");
      const csv = result.content.toString("utf-8");
      expect(csv).toContain('"Hello, World"');
    });

    it("escapes fields containing double quotes", () => {
      const data = [{ note: 'He said "hi"' }];
      const result = generateExport(data, "csv");
      const csv = result.content.toString("utf-8");
      expect(csv).toContain('"He said ""hi"""');
    });

    it("escapes fields containing newlines", () => {
      const data = [{ text: "line1\nline2" }];
      const result = generateExport(data, "csv");
      const csv = result.content.toString("utf-8");
      expect(csv).toContain('"line1\nline2"');
    });

    it("handles null and undefined values as empty strings", () => {
      const data = [{ a: null, b: undefined, c: "ok" }];
      const result = generateExport(data, "csv");
      const csv = result.content.toString("utf-8");
      const lines = csv.split("\n");
      expect(lines[1]).toBe(",,ok");
    });
  });

  describe("JSON format", () => {
    it("generates valid JSON from array of objects", () => {
      const data = [{ id: "1", total: 5000 }];
      const result = generateExport(data, "json");

      expect(result.contentType).toBe("application/json; charset=utf-8");
      const parsed = JSON.parse(result.content.toString("utf-8"));
      expect(parsed).toEqual([{ id: "1", total: 5000 }]);
    });

    it("extracts rows from { rows: [...] } shape", () => {
      const data = { rows: [{ x: 1 }, { x: 2 }] };
      const result = generateExport(data, "json");
      const parsed = JSON.parse(result.content.toString("utf-8"));
      expect(parsed).toEqual([{ x: 1 }, { x: 2 }]);
    });

    it("produces empty array JSON for empty input", () => {
      const result = generateExport([], "json");
      const parsed = JSON.parse(result.content.toString("utf-8"));
      expect(parsed).toEqual([]);
    });
  });

  describe("50MB file size enforcement", () => {
    it("throws ExportSizeLimitExceededError when content exceeds 50MB", () => {
      // Create a large dataset that will exceed 50MB when serialized
      const bigRow: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        bigRow[`col_${i}`] = "x".repeat(1000);
      }
      // Each row is ~100KB. 600 rows = ~60MB (exceeds 50MB)
      const data = Array.from({ length: 600 }, () => ({ ...bigRow }));

      expect(() => generateExport(data, "json")).toThrow(ExportSizeLimitExceededError);
    });

    it("allows files under 50MB", () => {
      const data = [{ a: "small", b: 123 }];
      const result = generateExport(data, "csv");
      expect(result.sizeBytes).toBeLessThan(MAX_EXPORT_SIZE_BYTES);
    });
  });
});

describe("exports/domain — buildFileKey", () => {
  it("builds correct S3 key for CSV format", () => {
    const key = buildFileKey("tenant-123", "export-456", "csv");
    expect(key).toBe("exports/tenant-123/export-456.csv");
  });

  it("builds correct S3 key for JSON format", () => {
    const key = buildFileKey("tenant-abc", "export-def", "json");
    expect(key).toBe("exports/tenant-abc/export-def.json");
  });
});

describe("exports/domain — computeExpiresAt", () => {
  it("returns a date approximately 24h in the future", () => {
    const before = Date.now();
    const expiresAt = computeExpiresAt();
    const after = Date.now();

    const expectedMinMs = before + PRESIGNED_URL_TTL_SECONDS * 1000;
    const expectedMaxMs = after + PRESIGNED_URL_TTL_SECONDS * 1000;

    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMinMs);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(expectedMaxMs);
  });
});

describe("exports/domain — constants", () => {
  it("MAX_EXPORT_SIZE_BYTES is exactly 50MB", () => {
    expect(MAX_EXPORT_SIZE_BYTES).toBe(50 * 1024 * 1024);
  });

  it("PRESIGNED_URL_TTL_SECONDS is exactly 24 hours", () => {
    expect(PRESIGNED_URL_TTL_SECONDS).toBe(86400);
  });
});
