/**
 * HRMS Packs #14, #27, #38, #42, #48, #50 — Thin modules validator coverage.
 *
 * Tests inline zod schemas replicated from their route files for:
 * - Service Book (Pack #14)
 * - Bulk Import (Pack #27)
 * - ID Cards (Pack #38)
 * - Orgchart (Pack #42)
 * - Social/Pulse (Pack #48)
 * - Visiting Cards (Pack #50)
 *
 * Source: respective modules' routes.ts with inline z.object() definitions
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

// ═══ Pack #14 — Service Book validators ═══
const serviceBookCreateBody = z.object({
  entryType: z.string().min(1),
  effectiveDate: z.string(),
  description: z.string().min(1),
  documentRef: z.string().optional(),
});

describe("Pack #14 — Service Book: create entry", () => {
  it("accepts valid entry", () => {
    expect(serviceBookCreateBody.safeParse({
      entryType: "increment", effectiveDate: "2026-07-01", description: "Annual increment",
    }).success).toBe(true);
  });

  it("rejects empty entryType", () => {
    expect(serviceBookCreateBody.safeParse({
      entryType: "", effectiveDate: "2026-07-01", description: "X",
    }).success).toBe(false);
  });

  it("rejects empty description", () => {
    expect(serviceBookCreateBody.safeParse({
      entryType: "transfer", effectiveDate: "2026-07-01", description: "",
    }).success).toBe(false);
  });

  it("documentRef is optional", () => {
    expect(serviceBookCreateBody.safeParse({
      entryType: "promotion", effectiveDate: "2026-07-01", description: "Promoted",
    }).success).toBe(true);
  });
});

// ═══ Pack #27 — Bulk Import validators ═══
const bulkImportBody = z.object({
  fileName: z.string().min(1).max(256),
  format: z.enum(["csv", "xlsx"]).default("csv"),
  entityType: z.enum(["employee", "attendance", "leave_allocation"]),
});

describe("Pack #27 — Bulk Import: upload body", () => {
  it("accepts valid import", () => {
    expect(bulkImportBody.safeParse({ fileName: "employees.csv", entityType: "employee" }).success).toBe(true);
  });

  it("rejects empty fileName", () => {
    expect(bulkImportBody.safeParse({ fileName: "", entityType: "employee" }).success).toBe(false);
  });

  it("rejects invalid entityType", () => {
    expect(bulkImportBody.safeParse({ fileName: "x.csv", entityType: "payroll" }).success).toBe(false);
  });

  it("rejects invalid format", () => {
    expect(bulkImportBody.safeParse({ fileName: "x.csv", entityType: "employee", format: "pdf" }).success).toBe(false);
  });

  it("defaults format to csv", () => {
    const result = bulkImportBody.safeParse({ fileName: "emp.csv", entityType: "employee" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.format).toBe("csv");
  });
});

// ═══ Pack #38 — ID Cards validators ═══
const idCardRequestBody = z.object({
  employeeId: z.string().uuid(),
  cardType: z.enum(["employee", "temporary", "contractor"]).default("employee"),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  photoRef: z.string().max(512).optional(),
});

describe("Pack #38 — ID Cards: request body", () => {
  it("accepts valid request", () => {
    expect(idCardRequestBody.safeParse({
      employeeId: "20000000-bbbb-4000-8000-000000000001",
    }).success).toBe(true);
  });

  it("rejects non-UUID employeeId", () => {
    expect(idCardRequestBody.safeParse({ employeeId: "bad" }).success).toBe(false);
  });

  it("rejects invalid cardType", () => {
    expect(idCardRequestBody.safeParse({
      employeeId: "20000000-bbbb-4000-8000-000000000001", cardType: "visitor",
    }).success).toBe(false);
  });

  it("rejects invalid date format for validUntil", () => {
    expect(idCardRequestBody.safeParse({
      employeeId: "20000000-bbbb-4000-8000-000000000001", validUntil: "2026",
    }).success).toBe(false);
  });

  it("defaults cardType to employee", () => {
    const result = idCardRequestBody.safeParse({ employeeId: "20000000-bbbb-4000-8000-000000000001" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.cardType).toBe("employee");
  });
});

// ═══ Pack #42 — Orgchart validators ═══
const orgchartQueryParams = z.object({
  departmentId: z.string().uuid().optional(),
  rootEmployeeId: z.string().uuid().optional(),
  depth: z.coerce.number().int().min(1).max(10).default(3),
});

describe("Pack #42 — Orgchart: query params", () => {
  it("accepts empty query (all optional)", () => {
    expect(orgchartQueryParams.safeParse({}).success).toBe(true);
  });

  it("accepts valid departmentId filter", () => {
    expect(orgchartQueryParams.safeParse({
      departmentId: "40000000-dddd-4000-8000-000000000001",
    }).success).toBe(true);
  });

  it("rejects non-UUID departmentId", () => {
    expect(orgchartQueryParams.safeParse({ departmentId: "bad" }).success).toBe(false);
  });

  it("rejects depth below 1 or above 10", () => {
    expect(orgchartQueryParams.safeParse({ depth: 0 }).success).toBe(false);
    expect(orgchartQueryParams.safeParse({ depth: 11 }).success).toBe(false);
  });

  it("defaults depth to 3", () => {
    const result = orgchartQueryParams.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.depth).toBe(3);
  });
});

// ═══ Pack #48 — Social/Pulse validators ═══
const pulseResponseBody = z.object({
  mood: z.enum(["great", "good", "okay", "bad", "terrible"]),
  comment: z.string().max(500).optional(),
  anonymous: z.boolean().default(false),
});

describe("Pack #48 — Social Pulse: response body", () => {
  it("accepts valid response", () => {
    expect(pulseResponseBody.safeParse({ mood: "great" }).success).toBe(true);
  });

  it("accepts all valid moods", () => {
    for (const m of ["great", "good", "okay", "bad", "terrible"]) {
      expect(pulseResponseBody.safeParse({ mood: m }).success).toBe(true);
    }
  });

  it("rejects invalid mood", () => {
    expect(pulseResponseBody.safeParse({ mood: "meh" }).success).toBe(false);
  });

  it("rejects comment exceeding 500 chars", () => {
    expect(pulseResponseBody.safeParse({ mood: "good", comment: "x".repeat(501) }).success).toBe(false);
  });

  it("defaults anonymous to false", () => {
    const result = pulseResponseBody.safeParse({ mood: "okay" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.anonymous).toBe(false);
  });
});

// ═══ Pack #50 — Visiting Cards validators ═══
const visitingCardBody = z.object({
  employeeId: z.string().uuid(),
  designation: z.string().min(1).max(128),
  department: z.string().min(1).max(128),
  mobile: z.string().max(20).optional(),
  email: z.string().email().optional(),
  officeAddress: z.string().max(500).optional(),
});

describe("Pack #50 — Visiting Cards: request body", () => {
  it("accepts valid request", () => {
    expect(visitingCardBody.safeParse({
      employeeId: "20000000-bbbb-4000-8000-000000000001",
      designation: "Under Secretary",
      department: "Finance",
    }).success).toBe(true);
  });

  it("rejects non-UUID employeeId", () => {
    expect(visitingCardBody.safeParse({
      employeeId: "bad", designation: "X", department: "Y",
    }).success).toBe(false);
  });

  it("rejects empty designation", () => {
    expect(visitingCardBody.safeParse({
      employeeId: "20000000-bbbb-4000-8000-000000000001",
      designation: "", department: "Finance",
    }).success).toBe(false);
  });

  it("rejects invalid email", () => {
    expect(visitingCardBody.safeParse({
      employeeId: "20000000-bbbb-4000-8000-000000000001",
      designation: "X", department: "Y", email: "bad",
    }).success).toBe(false);
  });

  it("optional fields are truly optional", () => {
    expect(visitingCardBody.safeParse({
      employeeId: "20000000-bbbb-4000-8000-000000000001",
      designation: "Officer", department: "Admin",
    }).success).toBe(true);
  });
});
