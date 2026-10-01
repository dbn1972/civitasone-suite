import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { HR_AUDIT_RESOURCE_TYPES } from "./auditResource";

/**
 * Drift guard (GAP-HR-AUDIT-LOG-08): derives the resource types hrms-service
 * and payroll-service actually emit from their producer call sites -- both the
 * `resourceType: "x"` literal form and the positional
 * `audit(tx, msg, "<action>", "<type>", id)` / `emitAudit(tx, ctx, "<action>",
 * "<type>", id)` form -- and requires each to be in HR_AUDIT_RESOURCE_TYPES.
 */
const SERVICES_ROOT = path.resolve(__dirname, "../../../../../../../services");

function collect(dir: string, out: Set<string>): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__" || e.name === "node_modules" || e.name === "dist") continue;
      collect(p, out);
    } else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) {
      const s = fs.readFileSync(p, "utf8");
      for (const m of s.matchAll(/resourceType:\s*"([a-z_]+)"/g)) out.add(m[1]!);
      for (const m of s.matchAll(/\b(?:audit|emitAudit)\([^"]*?"[^"]+",\s*"([a-z_]+)"/g)) out.add(m[1]!);
    }
  }
}

describe("HR_AUDIT_RESOURCE_TYPES", () => {
  const emitted = new Set<string>();
  for (const svc of ["hrms-service", "payroll-service"]) collect(path.join(SERVICES_ROOT, svc, "src"), emitted);

  it("finds producer call sites (guards against the scan silently matching nothing)", () => {
    expect(emitted.size).toBeGreaterThan(50);
  });

  it("includes positional-form types", () => {
    for (const t of ["payroll_structure", "tax_declaration", "loan", "payroll_pensioner", "screening_override", "application_fee"]) {
      expect(HR_AUDIT_RESOURCE_TYPES).toContain(t);
    }
  });

  it("covers every resource type the services emit", () => {
    const missing = [...emitted].filter((t) => !(HR_AUDIT_RESOURCE_TYPES as readonly string[]).includes(t));
    expect(missing).toEqual([]);
  });
});
