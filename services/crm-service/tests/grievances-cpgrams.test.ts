/**
 * grievances-cpgrams.test.ts
 *
 * Unit tests for CPGRAMS alignment in the grievances module.
 * These tests exercise grievances-domain.ts which is DB-free and
 * importable without pulling in Fastify or Drizzle.
 *
 * Coverage:
 *   - CPGRAMS status vocabulary (no legacy values)
 *   - Legacy-to-CPGRAMS status mapping
 *   - Ministry-prefixed reference number format
 *   - REF_PATTERN regex validation
 *   - Zod schemas: createBody, forwardBody, appealBody, resolveBody, assignBody
 */
import { describe, it, expect } from "vitest";
import {
  STATUS,
  PRIORITY,
  MINISTRY_CODE,
  REF_PATTERN,
  STATUS_LABEL,
  LEGACY_STATUS_MAP,
  grievanceRefPrefix,
  createBody,
  forwardBody,
  appealBody,
  resolveBody,
  assignBody,
} from "../src/modules/grievances/grievances-domain.js";

// ── Status vocabulary ──────────────────────────────────────────────────────────

describe("CPGRAMS status vocabulary", () => {
  it("STATUS contains exactly the five CPGRAMS values", () => {
    expect([...STATUS].sort()).toEqual([
      "APPEAL",
      "ATTENDED",
      "DISPOSED",
      "FORWARDED",
      "REGISTERED",
    ]);
  });

  it("no legacy CivitasOne values appear in STATUS", () => {
    const legacy = ["open", "assigned", "in_progress", "resolved", "closed", "escalated"];
    for (const l of legacy) {
      expect(STATUS as ReadonlyArray<string>).not.toContain(l);
    }
  });

  it("STATUS_LABEL has a non-empty label for every CPGRAMS status", () => {
    for (const s of STATUS) {
      expect(STATUS_LABEL).toHaveProperty(s);
      expect(STATUS_LABEL[s].length).toBeGreaterThan(0);
    }
  });

  it("PRIORITY contains expected values", () => {
    expect([...PRIORITY].sort()).toEqual(["high", "low", "normal", "urgent"]);
  });
});

// ── Legacy-to-CPGRAMS mapping ──────────────────────────────────────────────────

describe("LEGACY_STATUS_MAP", () => {
  it("maps all six legacy statuses", () => {
    expect(LEGACY_STATUS_MAP.open).toBe("REGISTERED");
    expect(LEGACY_STATUS_MAP.assigned).toBe("FORWARDED");
    expect(LEGACY_STATUS_MAP.in_progress).toBe("ATTENDED");
    expect(LEGACY_STATUS_MAP.resolved).toBe("DISPOSED");
    expect(LEGACY_STATUS_MAP.closed).toBe("DISPOSED");
    expect(LEGACY_STATUS_MAP.escalated).toBe("APPEAL");
  });

  it("all target values are valid CPGRAMS statuses", () => {
    for (const v of Object.values(LEGACY_STATUS_MAP)) {
      expect(STATUS as ReadonlyArray<string>).toContain(v);
    }
  });

  it("both resolved and closed map to DISPOSED", () => {
    expect(LEGACY_STATUS_MAP.resolved).toBe(LEGACY_STATUS_MAP.closed);
    expect(LEGACY_STATUS_MAP.resolved).toBe("DISPOSED");
  });
});

// ── Reference number format ────────────────────────────────────────────────────

describe("CPGRAMS reference number format", () => {
  it("REF_PATTERN validates well-formed reference numbers", () => {
    expect(REF_PATTERN.test("DARPG/2026/000001")).toBe(true);
    expect(REF_PATTERN.test("MHA/2026/123456")).toBe(true);
    expect(REF_PATTERN.test("MOEF/2025/999999")).toBe(true);
    expect(REF_PATTERN.test("AB/2030/000000")).toBe(true);
  });

  it("REF_PATTERN rejects the legacy GRV/YYYY/BASE36 format", () => {
    expect(REF_PATTERN.test("GRV/2026/ABC123")).toBe(false);
    expect(REF_PATTERN.test("GRV/2026/12345")).toBe(false);
  });

  it("REF_PATTERN rejects malformed references", () => {
    expect(REF_PATTERN.test("darpg/2026/000001")).toBe(false); // lowercase
    expect(REF_PATTERN.test("DARPG/26/000001")).toBe(false);   // 2-digit year
    expect(REF_PATTERN.test("DARPG/2026/00001")).toBe(false);  // 5 digits
    expect(REF_PATTERN.test("DARPG/2026/1234567")).toBe(false); // 7 digits
    expect(REF_PATTERN.test("DARPG-2026-000001")).toBe(false);  // wrong separator
    expect(REF_PATTERN.test("")).toBe(false);
  });

  it("grievanceRefPrefix returns MINISTRY_CODE/YYYY/ format", () => {
    const prefix = grievanceRefPrefix();
    const yr = new Date().getFullYear();
    expect(prefix).toBe(`${MINISTRY_CODE}/${yr}/`);
  });

  it("prefix alone does not match REF_PATTERN (sequence suffix required)", () => {
    expect(REF_PATTERN.test(grievanceRefPrefix())).toBe(false);
  });

  it("MINISTRY_CODE falls back to DARPG when env var is unset", () => {
    const expected = process.env.MINISTRY_CODE ?? "DARPG";
    expect(MINISTRY_CODE).toBe(expected);
  });

  it("full reference constructed from prefix + padded seq matches REF_PATTERN", () => {
    const ref = `${grievanceRefPrefix()}000042`;
    expect(REF_PATTERN.test(ref)).toBe(true);
  });
});

// ── Zod schemas ────────────────────────────────────────────────────────────────

describe("createBody schema", () => {
  it("accepts a minimal valid payload with default priority", () => {
    const result = createBody.safeParse({
      citizenName: "Ramesh Kumar",
      category: "Water Supply",
      subject: "No water for 3 days",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.priority).toBe("normal");
  });

  it("accepts all optional fields", () => {
    const result = createBody.safeParse({
      citizenName: "Priya Singh",
      category: "Roads",
      subject: "Pothole on main street",
      citizenPhone: "9876543210",
      citizenEmail: "priya@example.com",
      description: "Large pothole causing accidents",
      priority: "high",
      dueAt: "2026-09-01T00:00:00Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    expect(createBody.safeParse({ citizenName: "X" }).success).toBe(false);
    expect(createBody.safeParse({ category: "Y", subject: "Z" }).success).toBe(false);
  });
});

describe("forwardBody schema", () => {
  it("requires a non-empty forwardedTo string", () => {
    expect(forwardBody.safeParse({ forwardedTo: "Dept of Water Resources" }).success).toBe(true);
    expect(forwardBody.safeParse({ forwardedTo: "" }).success).toBe(false);
    expect(forwardBody.safeParse({}).success).toBe(false);
  });

  it("rejects forwardedTo exceeding 200 chars", () => {
    expect(forwardBody.safeParse({ forwardedTo: "A".repeat(201) }).success).toBe(false);
  });
});

describe("appealBody schema", () => {
  it("accepts an empty payload (appealReason is optional)", () => {
    expect(appealBody.safeParse({}).success).toBe(true);
  });

  it("accepts an appeal with a reason", () => {
    expect(
      appealBody.safeParse({ appealReason: "Grievance unresolved after 30 days" }).success
    ).toBe(true);
  });

  it("rejects appealReason exceeding 2000 chars", () => {
    expect(appealBody.safeParse({ appealReason: "A".repeat(2001) }).success).toBe(false);
  });
});

describe("resolveBody schema", () => {
  it("requires a non-empty resolution", () => {
    expect(resolveBody.safeParse({ resolution: "Pipe repaired on 10-Aug" }).success).toBe(true);
    expect(resolveBody.safeParse({ resolution: "" }).success).toBe(false);
    expect(resolveBody.safeParse({}).success).toBe(false);
  });
});

describe("assignBody schema", () => {
  it("requires a valid UUID for assignedTo", () => {
    expect(
      assignBody.safeParse({ assignedTo: "00000000-0000-0000-0000-000000000000" }).success
    ).toBe(true);
    expect(assignBody.safeParse({ assignedTo: "not-a-uuid" }).success).toBe(false);
    expect(assignBody.safeParse({}).success).toBe(false);
  });
});
