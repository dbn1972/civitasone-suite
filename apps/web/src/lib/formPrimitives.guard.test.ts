import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * SF-14 guard (slice a). Path-scoped, no baseline: every rule below holds for the whole scope it names today.
 *
 * (a) No raw response text reaches the user. `await <response>.text()` is fine for a success body (CSV, JSON parsed
 *     by hand) or to peek at an error `code`, but the text itself must never be rendered, thrown as an Error message,
 *     or stored into error/message state. Error copy comes from `useFormError` / `errorMessageFromResponse` /
 *     `userFacingErrorFromResponse` (status + code -> catalogued wording). Scope: everything under src/app except
 *     src/app/api (server route handlers, which never render UI).
 *
 * (b) CRM forms converted to the ds form primitives (`Field` + `Input`/`Select`/`Textarea`) must not regress to a bare
 *     `<input>` / `<select>` / `<textarea>` / `<label>`: that pairing loses the htmlFor/id link, aria-invalid,
 *     aria-describedby and required marking Field wires for free. Scope: the explicit list below; extend it as each
 *     SF-14 slice converts more forms (a converted file is added in the same PR).
 */
const APP = path.join(__dirname, "..", "app");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Receivers whose `.text()` is not an HTTP response body. */
const NOT_A_RESPONSE = /\b(file|blob|req|request)\s*\.\s*text\s*\(/;

function rawTextViolations(src: string): string[] {
  const code = stripComments(src);
  const found: string[] = [];
  const lines = code.split("\n");
  const vars = new Set<string>();
  lines.forEach((line, i) => {
    if (!/\.\s*text\s*\(\s*\)/.test(line) || NOT_A_RESPONSE.test(line)) return;
    // Direct: the awaited text is passed straight into an error sink.
    if (/(new\s+\w*Error\s*\(|\bset\w*\s*\(|\bmessage\s*:)[^;]*\.\s*text\s*\(\s*\)/.test(line)) {
      found.push(`line ${i + 1}: response text goes straight into an error/message sink`);
    }
    const m = /\b(?:const|let|var)\s+(\w+)\s*=[^;]*\.\s*text\s*\(\s*\)/.exec(line);
    if (m) vars.add(m[1]);
  });
  for (const v of vars) {
    const sinks = [
      new RegExp(`new\\s+\\w*Error\\s*\\(\\s*${v}\\b`),
      new RegExp(`\\bset\\w*\\(\\s*${v}\\b`),
      new RegExp(`\\bmessage\\s*:\\s*${v}\\b`),
      new RegExp(`\\b${v}\\s*(\\|\\||\\?\\?)\\s*["'\`]`),
      new RegExp(`\\{\\s*${v}\\s*\\}`),
      new RegExp("\\$\\{\\s*" + v + "\\s*\\}"),
    ];
    lines.forEach((line, i) => {
      if (sinks.some((re) => re.test(line))) found.push(`line ${i + 1}: \`${v}\` (raw response text) is rendered or used as an error message`);
    });
  }
  return found;
}

describe("SF-14 guard (a): no raw response text as a user-facing error", () => {
  const files = walk(APP).filter((f) => !f.includes(`${path.sep}api${path.sep}`));
  it("scans a meaningful number of files", () => expect(files.length).toBeGreaterThan(500));
  it("flags the known-bad patterns (self-test)", () => {
    expect(rawTextViolations('const body = await res.text();\nthrow new Error(body);').length).toBeGreaterThan(0);
    expect(rawTextViolations('const t = await res.text();\nreturn { message: t || "Failed" };').length).toBeGreaterThan(0);
    expect(rawTextViolations("setError(await res.text());").length).toBeGreaterThan(0);
    expect(rawTextViolations("const csv = await res.text();\ndownloadCsvFile(name, csv);")).toEqual([]);
    expect(rawTextViolations("const text = await file.text();\nsetError(text);")).toEqual([]);
  });
  it("no file under src/app (excluding api routes) shows raw response text", () => {
    const bad = files.flatMap((f) => rawTextViolations(readFileSync(f, "utf8")).map((v) => `${path.relative(APP, f)} ${v}`));
    expect(bad).toEqual([]);
  });
});

const CRM_CONVERTED = [
  "accounts/NewAccountForm.tsx",
  "accounts/[id]/AccountParentForm.tsx",
  "activities/LogActivityButton.tsx",
  "campaigns/[id]/PostPeriodForm.tsx",
  "contacts/[id]/ContactDetailActions.tsx",
  "deals/[id]/DealDetailActions.tsx",
  "health/[accountId]/FollowUpModal.tsx",
];

describe("SF-14 guard (b): converted CRM forms use ds Field, not bare input/label", () => {
  const crm = path.join(APP, "(app)", "crm");
  it.each(CRM_CONVERTED)("%s has no bare <input>/<select>/<textarea>/<label> and imports Field", (rel) => {
    const src = stripComments(readFileSync(path.join(crm, rel), "utf8"));
    expect(src.match(/<(input|select|textarea|label)\b/g) ?? []).toEqual([]);
    expect(src).toMatch(/\bField\b[^;]*from\s+["'][^"']*_components\/ds["']/);
  });
});
