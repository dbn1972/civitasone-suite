import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * W1 SF-05a grep guard: no `.tsx` under (app)/hr (which includes hr/payroll) or
 * (app)/payroll may render a raw Aadhaar / PAN / phone / mobile / bank account /
 * IFSC value as a JSX child (or as a `value:` of a detail row) unless the same
 * line goes through `<Masked>`, a `mask*()` helper, or one of the audited-reveal
 * controls. Display only: form <input value={...}> and request payloads are not
 * renders and are not matched.
 *
 * Exceptions live in ALLOW below, each with the reason. Add to it only with a
 * reviewable justification -- there is deliberately no baseline file.
 */
const APP_DIR = join(__dirname, "..");
const ROOTS = [join(APP_DIR, "hr"), join(APP_DIR, "payroll")].filter((d) => existsSync(d));

const FIELD = "(?:pan|panNumber|aadhaar\\w*|aadhar\\w*|phone|mobile|contactPhone|bankAccountNo|bankAccount|accountNo|accountNumber|bankIfsc|ifsc)";
// {expr.field...}  rendered as a JSX child (after a tag close or at the start of a line)
const NOT_DATA = "(?<!errors)(?<!Errors)(?<!current)"; // validation-error maps and refs are not data
const JSX_CHILD = new RegExp(`(?:(?<!=)>|^)\\s*\\{[^<]*${NOT_DATA}\\.${FIELD}\\b`);
// { label: ..., value: row.field }  detail-row style renders
const ROW_VALUE = new RegExp(`\\bvalue:\\s*[^,}]*${NOT_DATA}\\.${FIELD}\\b`);
const SAFE_ON_LINE = /<Masked\b|\bmask[A-Z]\w*\(|\bmaskPii\b|<ContactReveal\b|<RevealValue\b|<RevealAccount\b|<MaskedReveal\b/;

/** `relative/path.tsx::<trimmed line text>` -> why raw is acceptable here. */
const ALLOW: Record<string, string> = {
  "hr/payroll/disbursement/DisbursementTransferTable.tsx::<div style={{ fontSize: 11, color: \"var(--ink2)\" }}>{tx.ifsc}</div>":
    "IFSC is a public RBI branch routing code, not personal data; the account NUMBER on the same row is masked with an audited RevealAccount.",
  "hr/payroll/pensioners/[id]/page.tsx::{ label: t(\"bankIfsc\"), value: p.bankIfsc ?? none },":
    "IFSC is a public branch code; the pensioner's PAN and account number on this page use the audited RevealValue (POST /v1/payroll/pensioners/:id/reveal).",
  "hr/recruitment/[id]/page.tsx::<span>{app.email}{app.mobile ? ` · ${app.mobile}` : \"\"}</span>":
    "Service-masked (recruitment pii-mask.ts) and shown beside ContactReveal, the audited reveal-contact control.",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".tsx") && !/\.test\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

export function findRawPiiRenders(src: string): string[] {
  const hits: string[] = [];
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("*") || line.startsWith("/*") || line.startsWith("{/*")) continue;
    if (/\bref=\{/.test(line)) continue;
    if (/&&\s*\($/.test(line)) continue; // a conditional wrapper `{x.pan && (`, not a render
    if (!(JSX_CHILD.test(line) || ROW_VALUE.test(line))) continue;
    if (SAFE_ON_LINE.test(line)) continue;
    hits.push(line);
  }
  return hits;
}

describe("W1 SF-05a: no raw PII field renders under (app)/hr and (app)/payroll", () => {
  it("detector flags a raw render and accepts Masked / mask helpers", () => {
    expect(findRawPiiRenders("<span>{employee.pan}</span>")).toHaveLength(1);
    // the pre-SF-05a employee detail renders, which this guard exists to keep out:
    expect(findRawPiiRenders('<span className="v">{employee.phone}</span>')).toHaveLength(1);
    expect(findRawPiiRenders('<span className="v" style={{ fontFamily: "monospace" }}>{employee.bankAccountNo}</span>')).toHaveLength(1);
    expect(findRawPiiRenders("<td>{row.bankAccountNo}</td>")).toHaveLength(1);
    expect(findRawPiiRenders("{ label: \"x\", value: p.aadhaarRef }")).toHaveLength(1);
    expect(findRawPiiRenders("<Masked kind=\"pan\" value={employee.pan} />")).toHaveLength(0);
    expect(findRawPiiRenders("<td>{maskPan(row.pan)}</td>")).toHaveLength(0);
    expect(findRawPiiRenders("<input value={data.pan} onChange={f} />")).toHaveLength(0);
  });

  it("every .tsx render of a PII field is masked, revealed through an audited control, or allow-listed with a reason", () => {
    const offenders: string[] = [];
    const used = new Set<string>();
    for (const root of ROOTS) {
      for (const file of walk(root)) {
        const rel = relative(APP_DIR, file);
        for (const line of findRawPiiRenders(readFileSync(file, "utf8"))) {
          const key = `${rel}::${line}`;
          if (ALLOW[key]) used.add(key);
          else offenders.push(key);
        }
      }
    }
    expect(offenders).toEqual([]);
    // A stale allow-list entry means the exception is gone: delete it.
    expect(Object.keys(ALLOW).filter((k) => !used.has(k))).toEqual([]);
  });
});
