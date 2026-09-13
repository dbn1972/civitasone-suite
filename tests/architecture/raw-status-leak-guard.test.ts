/**
 * raw-status-leak-guard.mjs — fixture-based unit tests (UX-003, extended
 * UX-020).
 *
 * Exercises the exported `checkRawStatusLeakViolations()` directly against
 * in-memory source strings, mirroring
 * tests/architecture/raw-session-guc-guard.test.ts's shape.
 *
 * Run: pnpm exec vitest run tests/architecture/raw-status-leak-guard.test.ts
 */
import { describe, it, expect } from "vitest";
import { checkRawStatusLeakViolations } from "../../scripts/ci/raw-status-leak-guard.mjs";

describe("raw-status-leak-guard: checkRawStatusLeakViolations()", () => {
  it("flags a template literal that embeds res.status in parens (the UX-003 exemplar defect)", () => {
    const source = `setDialogError(errMsg || \`Create failed (\${res.status})\`);`;
    const violations = checkRawStatusLeakViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(1);
    expect(violations[0].reason).toMatch(/status code/i);
  });

  it("flags response.status and err.status the same way, case-insensitively", () => {
    expect(checkRawStatusLeakViolations("`failed (${response.status})`")).toHaveLength(1);
    expect(checkRawStatusLeakViolations("`failed (${err.statusCode})`")).toHaveLength(1);
    expect(checkRawStatusLeakViolations("`failed (${e.Status})`")).toHaveLength(1);
  });

  it('flags the literal phrase "Request failed" even without an interpolated status', () => {
    const source = `setMessage(text || "Request failed");`;
    const violations = checkRawStatusLeakViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toMatch(/Request failed/);
  });

  it('flags "Request failed" with an interpolated status as the status-in-parens case (one violation per line)', () => {
    const source = `setMessage(text || \`Request failed (\${res.status})\`);`;
    const violations = checkRawStatusLeakViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toMatch(/status code/i);
  });

  it("does NOT flag a call into the shared useFormError hook — the safe pattern", () => {
    const source = `
      if (!res.ok) {
        setStatus("error");
        await formError.fromResponse(res, "save");
        return;
      }
    `;
    expect(checkRawStatusLeakViolations(source)).toEqual([]);
  });

  it("does NOT flag res.status used for control flow (not shown to the user)", () => {
    const source = `if (res.status === 409) { setConflict(true); }`;
    expect(checkRawStatusLeakViolations(source)).toEqual([]);
  });

  it("respects the // status-leak-ok suppression comment", () => {
    const source = `setMessage(\`Create failed (\${res.status})\`); // status-leak-ok`;
    expect(checkRawStatusLeakViolations(source)).toEqual([]);
  });
});

describe("raw-status-leak-guard: UX-020 detection-gap fixes", () => {
  // Each fixture below is the literal offending line from the file:line the
  // UX-020 gap report evidence named, so this test suite fails first (red)
  // against the pre-UX-020 regex and passes (green) with the fix — the
  // "sabotage check" that keeps the detection honest per raw-status-leak-
  // guard.mjs's own doc comment: a future edit that narrows the regex back
  // to parens-only, or drops a verb from the literal family, breaks one of
  // these named tests, not just the fleet count.

  it("catches an un-parenthesized ${res.status} template interpolation (works/contractors/[id]/ContractorRatingForm.tsx:53)", () => {
    const source = "throw new Error(data?.message ?? `Error ${res.status}`);";
    const violations = checkRawStatusLeakViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toMatch(/status code/i);
  });

  it("catches the same un-parenthesized shape with a cast (works/execution/issues/IssueCloseForm.tsx:47, works/execution/issues/new/page.tsx:56)", () => {
    const source = "(data as { message?: string })?.message ?? `Error ${res.status}`";
    const violations = checkRawStatusLeakViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toMatch(/status code/i);
  });

  it("catches an un-parenthesized status interpolation with different surrounding copy (works/masters/MasterCreateForm.tsx:263)", () => {
    const source = "throw new Error(data?.message ?? `Server returned ${res.status}`);";
    const violations = checkRawStatusLeakViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toMatch(/status code/i);
  });

  it("catches String(res.status) with no interpolation syntax at all (works/execution/record-progress/page.tsx:77)", () => {
    const source = "if (!res.ok) throw new Error(String(res.status));";
    const violations = checkRawStatusLeakViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toMatch(/coerced to a string/i);
  });

  it('catches "Create failed" as part of the <Verb> failed family, not just the literal "Request failed" (works/execution/record-progress/page.tsx:122)', () => {
    const source = 'if (!res.ok) throw new Error(data?.message ?? "Create failed");';
    const violations = checkRawStatusLeakViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toMatch(/Create failed/);
  });

  it('also catches the sibling "<Verb> failed" fallbacks found fleet-wide (Update/Save/Delete/Submit/Upload/Load)', () => {
    expect(checkRawStatusLeakViolations('setError(x ?? "Update failed")')).toHaveLength(1);
    expect(checkRawStatusLeakViolations('setError(x ?? "Save failed")')).toHaveLength(1);
    expect(checkRawStatusLeakViolations('setError(x ?? "Delete failed")')).toHaveLength(1);
    expect(checkRawStatusLeakViolations('setError(x ?? "Submit failed")')).toHaveLength(1);
    expect(checkRawStatusLeakViolations('setMessage("Upload failed. Please try again.")')).toHaveLength(1);
    expect(checkRawStatusLeakViolations('setError(err.message ?? "load failed")')).toHaveLength(1);
  });

  it("does NOT flag \"fetch\" as part of the <Verb> failed family — dropped after a fleet dry run found it only ever matched developer comments, never user copy", () => {
    expect(checkRawStatusLeakViolations('// Previously this fetch failed silently and nobody noticed')).toEqual([]);
  });

  it("does NOT flag a comment describing a status leak, only real code (fleet dry run false positives this guard must not regress to)", () => {
    const source = [
      "// Never fabricate a 0 count when the list load failed — show \"—\" instead.",
      '/**',
      ' * So every create failed validation and had to be retried by hand.',
      ' */',
    ].join("\n");
    expect(checkRawStatusLeakViolations(source)).toEqual([]);
  });

  it("does NOT flag String(x.status) used for a value comparison, only when it becomes the error text (fleet dry run false positive: admin/api-monitoring, admin/editions, admin/entitlements)", () => {
    const source = 'const healthy = endpoints.filter((e) => String(e.status).toLowerCase() === "healthy").length;';
    expect(checkRawStatusLeakViolations(source)).toEqual([]);
  });

  it("still flags String(res.status) when nothing is chained after it (the real leak, not the comparison false positive)", () => {
    const source = "throw new Error(String(response.statusCode));";
    expect(checkRawStatusLeakViolations(source)).toHaveLength(1);
  });
});
