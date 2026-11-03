import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CODE_FAMILIES, SERVICE_CODE_MESSAGES, resolveServiceCode, type ServiceCodeMessage } from "./serviceErrorCodes";
import { DOMAIN_CODE_MESSAGES, resolveHumanError } from "./errorCatalogue";

/**
 * GAP-UAT-P3-ERRCOPY: every error code the services can return has a plain-language
 * message in English and Hindi -- its own entry, or the message of its naming family.
 */
const SERVICES = resolve(__dirname, "../../../../services");
const CODE_PATTERNS = [
  /Error\(\s*\d{3},\s*"([A-Z][A-Z0-9_]{2,})"/g, // new HttpError(409, "CODE", ...)
  /DomainError\(\s*"([A-Z][A-Z0-9_]{2,})"/g, // new DomainError("CODE", ...)
  /send\(\{\s*code:\s*"([A-Z][A-Z0-9_]{2,})"/g, // reply.send({ code: "CODE", ... })
  /code:\s*"([A-Z][A-Z0-9_]{2,})",\s*message/g, // { code: "CODE", message: ... }
];

function walk(dir: string, out: string[]): void {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const name = ent.name;
    if (name === "node_modules" || name === "dist" || name === "tests" || name === "__tests__" || name === "migrations") continue;
    const p = join(dir, name);
    // Symlinks are skipped (a dangling seed link must not break the scan).
    if (ent.isDirectory()) walk(p, out);
    else if (ent.isFile() && name.endsWith(".ts") && !name.includes(".test.") && !name.endsWith(".d.ts")) out.push(p);
  }
}

function harvestServiceCodes(): Set<string> {
  const files: string[] = [];
  walk(SERVICES, files);
  const codes = new Set<string>();
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const re of CODE_PATTERNS) for (const m of src.matchAll(re)) if (m[1].includes("_")) codes.add(m[1]);
  }
  return codes;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const DEVANAGARI = /[ऀ-ॿ]/;

function familyMessages(): Array<[string, ServiceCodeMessage]> {
  return CODE_FAMILIES.filter((f) => f.message).map((f) => [f.id, f.message as ServiceCodeMessage]);
}

describe("service error codes: every code the services return has a mapping", () => {
  const codes = harvestServiceCodes();

  it("finds the service codes (sanity: the scan works)", () => {
    expect(codes.size).toBeGreaterThan(800);
    for (const c of ["MAKER_CHECKER_VIOLATION", "TASK_NOT_AUTHORIZED", "SANCTION_REF_REQUIRED", "BUDGET_EXCEEDED", "NO_EMPLOYEE_RECORD"]) {
      expect(codes.has(c), c).toBe(true);
    }
  });

  it("every harvested code resolves to its own entry, a domain entry or a naming family", () => {
    const unmapped = [...codes].filter((c) => !Object.prototype.hasOwnProperty.call(DOMAIN_CODE_MESSAGES, c) && resolveServiceCode(c) === null);
    expect(unmapped, "add an entry to SERVICE_CODE_MESSAGES (en + hi) for: " + unmapped.join(", ")).toEqual([]);
  });

  it("no harvested code resolves to copy that shows the code or blames the internet connection", () => {
    for (const code of codes) {
      for (const locale of ["en", "hi"] as const) {
        const r = resolveHumanError({ status: 409, code, ctx: { locale, intent: "save" } });
        const text = r.what + " " + r.next;
        expect(text, code).not.toContain(code);
        expect(text, code).not.toMatch(/internet|इंटरनेट/i);
        expect(text, code).not.toMatch(/\{\w+\}/);
        expect(r.what.trim().length, code).toBeGreaterThan(0);
        expect(r.next.trim().length, code).toBeGreaterThan(0);
      }
    }
  });
});

describe("service error codes: en/hi parity of the copy", () => {
  const all: Array<[string, ServiceCodeMessage]> = [...Object.entries(SERVICE_CODE_MESSAGES), ...familyMessages()];

  it.each(all)("%s has en and hi copy, Hindi in Devanagari, matching placeholders", (_id, m) => {
    for (const part of ["what", "next"] as const) {
      expect(m.en[part].trim()).not.toBe("");
      expect(m.hi[part].trim()).not.toBe("");
      expect(m.hi[part]).not.toBe(m.en[part]);
      expect(DEVANAGARI.test(m.hi[part])).toBe(true);
      expect(placeholders(m.hi[part])).toEqual(placeholders(m.en[part]));
      expect(m.en[part]).not.toMatch(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/);
      expect(m.en[part]).toMatch(/[.!?]$/);
    }
  });
});

describe("service error codes: the codes named in the UAT findings", () => {
  const cases: Array<[string, string, string]> = [
    ["MAKER_CHECKER_VIOLATION", "someone other than the person who made it", "किसी और की मंज़ूरी"],
    ["TASK_NOT_AUTHORIZED", "This task isn't assigned to you.", "यह कार्य आपको नहीं सौंपा गया है।"],
    ["SANCTION_REF_REQUIRED", "approved budget sanction", "बजट संस्वीकृति"],
    ["BUDGET_EXCEEDED", "more than the budget still available", "शेष बजट से अधिक"],
    ["ZERO_BASIC_SLIPS", "no basic pay", "मूल वेतन नहीं"],
    ["NO_EMPLOYEE_RECORD", "not linked to an employee record", "कर्मचारी रिकॉर्ड से जुड़ा नहीं"],
    ["EMPLOYEE_NO_EXISTS", "employee number already exists", "पहले से मौजूद"],
  ];
  it.each(cases)("%s reads as its own reason in en and hi", (code, en, hi) => {
    const e = resolveHumanError({ status: 409, code, ctx: { locale: "en" } });
    const h = resolveHumanError({ status: 409, code, ctx: { locale: "hi" } });
    expect(e.what + " " + e.next).toContain(en);
    expect(h.what + " " + h.next).toContain(hi);
    expect(e.source === "domain" || e.source === "serviceCode").toBe(true);
  });
});

describe("service error codes: families", () => {
  it("a *_NOT_FOUND code reads as not found, with the caller object", () => {
    const r = resolveHumanError({ status: 404, code: "VENDOR_NOT_FOUND", ctx: { locale: "en", area: "vendor" } });
    expect(r.what).toBe("We couldn't find this vendor.");
    expect(r.source).toBe("codeFamily");
  });

  it("a state code reads as the stage rule, not as a generic conflict", () => {
    const r = resolveHumanError({ status: 409, code: "INVALID_STATE", ctx: { locale: "en" } });
    expect(r.what).toBe("This record is not at a stage that allows this action.");
    expect(r.next).toContain("Refresh the page");
  });

  it("a *_REQUIRED code with field errors points at the highlighted fields", () => {
    const withFields = resolveHumanError({ status: 422, code: "REASON_REQUIRED", ctx: { locale: "en", hasFieldErrors: true } });
    expect(withFields.next).toBe("Check the highlighted fields and try again.");
    const without = resolveHumanError({ status: 422, code: "REASON_REQUIRED", ctx: { locale: "en" } });
    expect(without.what).toBe("Some required information is missing.");
  });

  it("an *_EXISTS code reads as a duplicate record, never as \"A information\"", () => {
    const r = resolveHumanError({ status: 409, code: "SHIFT_NAME_EXISTS", ctx: { locale: "en" } });
    expect(r.what).toBe("A record with these details already exists.");
  });

  it("a permission code says whom to ask", () => {
    const r = resolveHumanError({ status: 403, code: "NOT_ASSIGNEE", ctx: { locale: "en" } });
    expect(r.next).toContain("Ask your administrator");
  });

  it("a gateway/upstream code reads as a problem on our side, not the connection", () => {
    const r = resolveHumanError({ status: 502, code: "UPSTREAM_UNAVAILABLE", ctx: { locale: "en", intent: "load", area: "journal approvals" } });
    expect(r.what).toBe("We couldn't load the journal approvals because of a problem on our side.");
    expect(r.next).not.toMatch(/internet/i);
  });

  it("a caller-pinned situation (forceKind) still wins over a family", () => {
    const r = resolveHumanError({ status: 409, code: "INVALID_STATE", forceKind: "forbidden", ctx: { locale: "en" } });
    expect(r.what).toBe("You don't have permission to do this.");
  });
});
