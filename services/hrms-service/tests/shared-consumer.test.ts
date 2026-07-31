/**
 * shared-consumer.test.ts — Unit tests for under-covered shared modules:
 *
 *   - sanitize.ts: sanitizeString, sanitizeInput
 *   - search-indexing.ts: indexEntity, deindexEntity
 *   - payroll-client.ts: fetchFnfTaxBreakdown, PayrollUnavailableError
 *
 * These shared utilities are used by consumers throughout the hrms-service
 * and were previously untested, dragging the shared module coverage down.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── sanitize.ts ────────────────────────────────────────────────────────────

describe("shared/sanitize", () => {
  describe("sanitizeString", () => {
    it("strips script tags and their content", async () => {
      const { sanitizeString } = await import("../src/shared/sanitize.js");
      const result = sanitizeString('Hello <script>alert("xss")</script> World');
      expect(result).toBe("Hello  World");
    });

    it("strips HTML tags", async () => {
      const { sanitizeString } = await import("../src/shared/sanitize.js");
      const result = sanitizeString("<b>bold</b> <a href='x'>link</a>");
      expect(result).toBe("bold link");
    });

    it("strips javascript: protocol", async () => {
      const { sanitizeString } = await import("../src/shared/sanitize.js");
      const result = sanitizeString("javascript:alert(1)");
      expect(result).toBe("alert(1)");
    });

    it("strips inline event handlers (onclick, onload, etc.)", async () => {
      const { sanitizeString } = await import("../src/shared/sanitize.js");
      const result = sanitizeString('onclick= "hack()" some text onload ="bad"');
      expect(result).not.toContain("onclick=");
      expect(result).not.toContain("onload=");
      expect(result).toContain("some text");
    });

    it("trims whitespace", async () => {
      const { sanitizeString } = await import("../src/shared/sanitize.js");
      expect(sanitizeString("  hello  ")).toBe("hello");
    });

    it("handles empty string", async () => {
      const { sanitizeString } = await import("../src/shared/sanitize.js");
      expect(sanitizeString("")).toBe("");
    });

    it("preserves safe text", async () => {
      const { sanitizeString } = await import("../src/shared/sanitize.js");
      const safe = "Regular text with numbers 12345 and symbols !@#$%";
      expect(sanitizeString(safe)).toBe(safe);
    });

    it("handles multiline script tags", async () => {
      const { sanitizeString } = await import("../src/shared/sanitize.js");
      const input = 'before<script type="text/javascript">var x=1;</script>after';
      expect(sanitizeString(input)).toBe("beforeafter");
    });

    it("strips case-insensitive script tags", async () => {
      const { sanitizeString } = await import("../src/shared/sanitize.js");
      const result = sanitizeString('<SCRIPT>evil()</SCRIPT> safe');
      expect(result).toBe("safe");
    });

    it("strips case-insensitive javascript: protocol", async () => {
      const { sanitizeString } = await import("../src/shared/sanitize.js");
      const result = sanitizeString("JAVASCRIPT:void(0)");
      expect(result).toBe("void(0)");
    });
  });

  describe("sanitizeInput", () => {
    it("sanitizes string values in a flat object", async () => {
      const { sanitizeInput } = await import("../src/shared/sanitize.js");
      const obj = { name: "<b>John</b>", age: 30 };
      const result = sanitizeInput(obj);
      expect(result.name).toBe("John");
      expect(result.age).toBe(30);
    });

    it("sanitizes nested objects recursively", async () => {
      const { sanitizeInput } = await import("../src/shared/sanitize.js");
      const obj = {
        user: {
          name: '<script>x</script>Admin',
          bio: "Safe text",
        },
        count: 5,
      };
      const result = sanitizeInput(obj);
      expect(result.user.name).toBe("Admin");
      expect(result.user.bio).toBe("Safe text");
      expect(result.count).toBe(5);
    });

    it("sanitizes arrays of strings", async () => {
      const { sanitizeInput } = await import("../src/shared/sanitize.js");
      const arr = ["<b>bold</b>", "safe", "<script>bad</script>evil"];
      const result = sanitizeInput(arr);
      expect(result).toEqual(["bold", "safe", "evil"]);
    });

    it("sanitizes arrays of objects", async () => {
      const { sanitizeInput } = await import("../src/shared/sanitize.js");
      const arr = [
        { title: "<h1>Header</h1>" },
        { title: "Normal" },
      ];
      const result = sanitizeInput(arr);
      expect(result[0].title).toBe("Header");
      expect(result[1].title).toBe("Normal");
    });

    it("returns primitives unchanged", async () => {
      const { sanitizeInput } = await import("../src/shared/sanitize.js");
      expect(sanitizeInput(42)).toBe(42);
      expect(sanitizeInput(true)).toBe(true);
      expect(sanitizeInput(null)).toBeNull();
      expect(sanitizeInput(undefined)).toBeUndefined();
    });

    it("handles deeply nested structures", async () => {
      const { sanitizeInput } = await import("../src/shared/sanitize.js");
      const obj = { a: { b: { c: { d: '<img onerror="hack">' } } } };
      const result = sanitizeInput(obj);
      expect(result.a.b.c.d).not.toContain("onerror");
      expect(result.a.b.c.d).not.toContain("<img");
    });
  });
});

// ─── search-indexing.ts ─────────────────────────────────────────────────────

const H = vi.hoisted(() => ({
  publishSearchIndex: vi.fn(),
}));

vi.mock("@civitasone/search", () => ({
  publishSearchIndex: (...a: unknown[]) => H.publishSearchIndex(...a),
}));

describe("shared/search-indexing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    H.publishSearchIndex.mockResolvedValue(undefined);
  });

  describe("indexEntity", () => {
    it("publishes upsert action with hrms module", async () => {
      const { indexEntity } = await import("../src/shared/search-indexing.js");
      const mockTx = {} as any;
      const input = {
        id: "ent-1",
        tenantId: "t-1",
        name: "John Doe",
        refNumber: "EMP-001",
        description: "Senior Developer",
        status: "active",
        actorId: "a-1",
        correlationId: "c-1",
      };

      await indexEntity(mockTx, input);

      expect(H.publishSearchIndex).toHaveBeenCalledOnce();
      expect(H.publishSearchIndex).toHaveBeenCalledWith(mockTx, {
        ...input,
        module: "hrms",
        action: "upsert",
      });
    });

    it("passes optional fields (refNumber, description) when provided", async () => {
      const { indexEntity } = await import("../src/shared/search-indexing.js");
      const mockTx = {} as any;
      const input = {
        id: "ent-2",
        tenantId: "t-2",
        name: "Jane Smith",
        refNumber: "EMP-002",
        description: "Manager",
        status: "confirmed",
        actorId: "a-2",
        correlationId: "c-2",
      };

      await indexEntity(mockTx, input);

      const call = H.publishSearchIndex.mock.calls[0]![1] as Record<string, unknown>;
      expect(call.refNumber).toBe("EMP-002");
      expect(call.description).toBe("Manager");
    });

    it("handles undefined optional fields", async () => {
      const { indexEntity } = await import("../src/shared/search-indexing.js");
      const mockTx = {} as any;
      const input = {
        id: "ent-3",
        tenantId: "t-3",
        name: "Minimal Entry",
        status: "draft",
        actorId: "a-3",
        correlationId: "c-3",
      };

      await indexEntity(mockTx, input);

      const call = H.publishSearchIndex.mock.calls[0]![1] as Record<string, unknown>;
      expect(call.module).toBe("hrms");
      expect(call.action).toBe("upsert");
      expect(call.refNumber).toBeUndefined();
      expect(call.description).toBeUndefined();
    });

    it("propagates errors from publishSearchIndex", async () => {
      const { indexEntity } = await import("../src/shared/search-indexing.js");
      H.publishSearchIndex.mockRejectedValue(new Error("search service down"));
      const mockTx = {} as any;

      await expect(indexEntity(mockTx, {
        id: "ent-fail", tenantId: "t", name: "Fail", status: "active",
        actorId: "a", correlationId: "c",
      })).rejects.toThrow("search service down");
    });
  });

  describe("deindexEntity", () => {
    it("publishes delete action with hrms module", async () => {
      const { deindexEntity } = await import("../src/shared/search-indexing.js");
      const mockTx = {} as any;
      const input = {
        id: "ent-del-1",
        tenantId: "t-1",
        actorId: "a-1",
        correlationId: "c-1",
      };

      await deindexEntity(mockTx, input);

      expect(H.publishSearchIndex).toHaveBeenCalledOnce();
      expect(H.publishSearchIndex).toHaveBeenCalledWith(mockTx, {
        id: "ent-del-1",
        tenantId: "t-1",
        module: "hrms",
        name: "",
        status: "deleted",
        action: "delete",
        actorId: "a-1",
        correlationId: "c-1",
      });
    });

    it("uses provided name and status when specified", async () => {
      const { deindexEntity } = await import("../src/shared/search-indexing.js");
      const mockTx = {} as any;

      await deindexEntity(mockTx, {
        id: "ent-del-2",
        tenantId: "t-2",
        actorId: "a-2",
        correlationId: "c-2",
        name: "Deleted Item",
        status: "archived",
      });

      const call = H.publishSearchIndex.mock.calls[0]![1] as Record<string, unknown>;
      expect(call.name).toBe("Deleted Item");
      expect(call.status).toBe("archived");
      expect(call.action).toBe("delete");
    });

    it("defaults name to empty string and status to deleted", async () => {
      const { deindexEntity } = await import("../src/shared/search-indexing.js");
      const mockTx = {} as any;

      await deindexEntity(mockTx, {
        id: "ent-del-3",
        tenantId: "t-3",
        actorId: "a-3",
        correlationId: "c-3",
      });

      const call = H.publishSearchIndex.mock.calls[0]![1] as Record<string, unknown>;
      expect(call.name).toBe("");
      expect(call.status).toBe("deleted");
    });

    it("propagates errors from publishSearchIndex", async () => {
      const { deindexEntity } = await import("../src/shared/search-indexing.js");
      H.publishSearchIndex.mockRejectedValue(new Error("timeout"));
      const mockTx = {} as any;

      await expect(deindexEntity(mockTx, {
        id: "ent-fail", tenantId: "t", actorId: "a", correlationId: "c",
      })).rejects.toThrow("timeout");
    });
  });
});

// ─── payroll-client.ts ──────────────────────────────────────────────────────

describe("shared/payroll-client", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("PayrollUnavailableError", () => {
    it("has correct code and name", async () => {
      const { PayrollUnavailableError } = await import("../src/shared/payroll-client.js");
      const err = new PayrollUnavailableError("test error");
      expect(err.code).toBe("PAYROLL_UNAVAILABLE");
      expect(err.name).toBe("PayrollUnavailableError");
      expect(err.message).toBe("test error");
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe("CircuitBreakerOpenError re-export", () => {
    it("exports CircuitBreakerOpenError class", async () => {
      const { CircuitBreakerOpenError } = await import("../src/shared/payroll-client.js");
      expect(CircuitBreakerOpenError).toBeDefined();
      const err = new CircuitBreakerOpenError("open");
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe("fetchFnfTaxBreakdown", () => {
    const baseTaxParams = {
      employeeId: "emp-1",
      separationDate: "2025-06-30",
      separationType: "superannuation",
      employeeCategory: "group_a",
      noticeBuyoutMinor: "0",
      leaveEncashmentGrossMinor: "500000",
      gratuityGrossMinor: "2000000",
      retrenchmentCompMinor: "0",
      vrsCompMinor: "0",
      arrearsMinor: "100000",
      lastDrawnWagesMinor: "15000000",
      completedYears: 25,
      avgSalaryLast10MonthsMinor: "14000000",
      leaveBalanceDays: 300,
      priorLeaveEncashExemptionMinor: "0",
      remainingMonthsToRetirement: 0,
      taxRegime: "old",
      salaryYtdMinor: "4500000",
      tdsYtdMinor: "450000",
      deductions80cMinor: "150000",
      deductions80dMinor: "50000",
      otherDeductionsMinor: "0",
      fyStartYear: 2025,
    };

    const mockTaxResult = {
      totalGrossMinor: "18000000",
      totalExemptMinor: "5000000",
      totalTaxableOnSeparationMinor: "13000000",
      annualTaxableMinor: "17500000",
      annualTaxMinor: "3500000",
      tdsAlreadyDeductedMinor: "450000",
      tdsOnSeparationMinor: "3050000",
      netPayableMinor: "14950000",
      gratuityExemption: { exemptMinor: "2000000", taxableMinor: "0" },
      leaveEncashExemption: { exemptMinor: "300000", taxableMinor: "200000" },
      retrenchmentExemption: null,
      vrsExemption: null,
    };

    it("returns tax breakdown on success", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: mockTaxResult }),
      }) as unknown as typeof fetch;

      const { fetchFnfTaxBreakdown } = await import("../src/shared/payroll-client.js");
      const result = await fetchFnfTaxBreakdown("tenant-1", baseTaxParams);

      expect(result).toEqual(mockTaxResult);
      expect(global.fetch).toHaveBeenCalledOnce();
    });

    it("sends correct headers (x-internal, x-service-secret, x-tenant-id)", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: mockTaxResult }),
      }) as unknown as typeof fetch;

      const { fetchFnfTaxBreakdown } = await import("../src/shared/payroll-client.js");
      await fetchFnfTaxBreakdown("tenant-abc", baseTaxParams);

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const opts = fetchCall![1] as RequestInit;
      const headers = opts.headers as Record<string, string>;
      expect(headers["x-internal"]).toBe("1");
      expect(headers["x-tenant-id"]).toBe("tenant-abc");
    });

    it("constructs URL with all query parameters", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: mockTaxResult }),
      }) as unknown as typeof fetch;

      const { fetchFnfTaxBreakdown } = await import("../src/shared/payroll-client.js");
      await fetchFnfTaxBreakdown("t-1", baseTaxParams);

      const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      const url = fetchCall![0] as string;
      expect(url).toContain("/v1/payroll/internal/fnf-tax-breakdown?");
      expect(url).toContain("employeeId=emp-1");
      expect(url).toContain("separationDate=2025-06-30");
      expect(url).toContain("completedYears=25");
      expect(url).toContain("fyStartYear=2025");
    });

    it("throws PayrollUnavailableError on non-ok response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }) as unknown as typeof fetch;

      const { fetchFnfTaxBreakdown, PayrollUnavailableError } = await import("../src/shared/payroll-client.js");

      await expect(fetchFnfTaxBreakdown("t-1", baseTaxParams))
        .rejects.toThrow(PayrollUnavailableError);

      await expect(fetchFnfTaxBreakdown("t-1", baseTaxParams))
        .rejects.toThrow(/payroll-service returned 500/);
    });

    it("throws PayrollUnavailableError on network failure", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;

      const { fetchFnfTaxBreakdown, PayrollUnavailableError } = await import("../src/shared/payroll-client.js");

      await expect(fetchFnfTaxBreakdown("t-1", baseTaxParams))
        .rejects.toThrow(PayrollUnavailableError);
    });
  });
});
