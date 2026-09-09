/**
 * raw-status-leak-guard.mjs — fixture-based unit tests (UX-003).
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
