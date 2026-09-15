/**
 * raw-session-guc-guard.mjs — fixture-based unit tests (PERF-001 fix-up).
 *
 * Exercises the exported `checkTenantGucViolations()` / `checkAdvisoryLockViolations()`
 * functions directly against in-memory source strings, mirroring
 * tests/architecture/tenant-router-guard.test.ts's shape.
 *
 * Run: pnpm exec vitest run tests/architecture/raw-session-guc-guard.test.ts
 */
import { describe, it, expect } from "vitest";
import {
  checkTenantGucViolations,
  checkAdvisoryLockViolations,
} from "../../scripts/ci/raw-session-guc-guard.mjs";

describe("raw-session-guc-guard: checkTenantGucViolations()", () => {
  it("reports a raw SQL `SET app.tenant_id = ...` (the exact PR #1098 defect) as a violation", () => {
    const source = `
SET app.tenant_id = '00000000-0000-0000-0000-000000000001';

INSERT INTO budget.finance_heads (id, tenant_id) VALUES ('x', 'y');
`;
    const violations = checkTenantGucViolations(source, true);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(2);
    expect(violations[0].snippet).toContain("SET app.tenant_id");
  });

  it("reports raw `SET SESSION app.tenant_id = ...` as a violation", () => {
    const source = `SET SESSION app.tenant_id = '00000000-0000-0000-0000-000000000000';`;
    const violations = checkTenantGucViolations(source, true);
    expect(violations).toHaveLength(1);
  });

  it("reports set_config(..., false) (explicit session scope) as a violation", () => {
    const source = `select set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', false);`;
    const violations = checkTenantGucViolations(source, true);
    expect(violations).toHaveLength(1);
    expect(violations[0].snippet).toContain("set_config");
  });

  it("reports set_config(..., false) from a TS raw-SQL string as a violation", () => {
    const source = `
await sql.unsafe(\`select set_config('app.tenant_id', '\${T}', false)\`);
`;
    const violations = checkTenantGucViolations(source, false);
    expect(violations).toHaveLength(1);
  });

  it("does NOT flag `SET LOCAL app.tenant_id = ...` — the safe pattern", () => {
    const source = `
DO $body$
BEGIN
  SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000001';
END
$body$;
`;
    expect(checkTenantGucViolations(source, true)).toEqual([]);
  });

  it("does NOT flag set_config(..., true) — the established safe pattern (migration 0025 / raw-tenant-guc.ts)", () => {
    const source = `
DO $body$
BEGIN
  PERFORM set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', true);
  UPDATE plan.audit_plans SET status = 'completed' WHERE id = '1';
END
$body$;
`;
    expect(checkTenantGucViolations(source, true)).toEqual([]);
  });

  it("does NOT flag a raw SET mentioned only inside a SQL comment", () => {
    const source = `
-- Scoped to this migration script's session only.
-- Historical note: this used to be a raw SET app.tenant_id = 'x'; before the fix.
SELECT set_config('app.tenant_id', 'x', true);
`;
    expect(checkTenantGucViolations(source, true)).toEqual([]);
  });

  it("does NOT flag a raw SET mentioned only inside a TS comment", () => {
    const source = `
// old code used to do: SET app.tenant_id = 'x';
await tx.unsafe(\`select set_config('app.tenant_id', '\${T}', true)\`);
`;
    expect(checkTenantGucViolations(source, false)).toEqual([]);
  });

  it("does NOT flag an unrelated SET (not app.*/tenant.*)", () => {
    const source = `SET lock_timeout = '5s';`;
    expect(checkTenantGucViolations(source, true)).toEqual([]);
  });

  // ── PERF-013: confirmed false negatives (docs/ENTERPRISE-GAP-REPORT-2026-09-07.md) ──
  // Each of these four reproduces one of the adversarial inputs the gap row
  // hand-crafted: the guard's pre-fix regex/line-by-line logic misses all
  // four despite each being the exact same underlying bug (a session-scoped
  // GUC set outside SET LOCAL / a transaction-scoped set_config) PR #1098
  // already fixed two real instances of.

  it("reports raw `SET app.tenant_id TO '...'` — the alternate Postgres SET syntax — as a violation", () => {
    const source = `SET app.tenant_id TO '00000000-0000-0000-0000-000000000001';`;
    const violations = checkTenantGucViolations(source, true);
    expect(violations).toHaveLength(1);
    expect(violations[0].snippet).toContain("SET app.tenant_id");
  });

  it("reports a raw SET whose keyword and identifier/operator are split across lines", () => {
    const source = `
SET
  app.tenant_id = '00000000-0000-0000-0000-000000000001';
`;
    const violations = checkTenantGucViolations(source, true);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(2);
  });

  it("reports a raw SET statement built via string concatenation as a violation", () => {
    const source = `
const stmt = "SET app.tenant_id" + " = '" + tenantId + "'";
await sql.unsafe(stmt);
`;
    const violations = checkTenantGucViolations(source, false);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(2);
  });

  it("reports set_config(..., <non-literal>) — a variable third arg that can't be statically proven `true` — as a violation", () => {
    const source = `PERFORM set_config('app.tenant_id', tenant_uuid, is_local_flag);`;
    const violations = checkTenantGucViolations(source, true);
    expect(violations).toHaveLength(1);
    expect(violations[0].snippet).toContain("set_config");
  });

  // ── Regression guards: the broadened matching above must not start
  // flagging the established safe patterns. ──
  it("does NOT flag `SET LOCAL app.tenant_id = ...` split across lines", () => {
    const source = `
DO $body$
BEGIN
  SET
    LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000001';
END
$body$;
`;
    expect(checkTenantGucViolations(source, true)).toEqual([]);
  });

  it("does NOT flag set_config(..., true) regardless of case/whitespace around the literal", () => {
    const source = `select set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001',  TRUE  );`;
    expect(checkTenantGucViolations(source, true)).toEqual([]);
  });

  // ── PERF-013 review follow-up (Issue A): the bare `\bTO\b` added above to
  // catch Postgres's `SET x TO y` syntax also matches the ordinary English
  // word "to" — a false positive in application code that is not SQL at
  // all. Reproduces the reviewer's own live repro against the shipped
  // guard; both must resolve to zero violations now that bare `TO` is
  // gated to isSql===true (SQL contexts only). ──
  it("does NOT flag a plain-English string containing SET .. app.foo .. to — not SQL (PERF-013 review false positive)", () => {
    const source = `throw new Error("SET app.tenant_id to a valid UUID before calling this");`;
    expect(checkTenantGucViolations(source, false)).toEqual([]);
  });

  it("does NOT flag a multi-line logger.warn(...) string containing SET .. app.foo .. to — not SQL (PERF-013 review false positive)", () => {
    const source = `
logger.warn(
  "SET app.tenant_id " +
    "to a valid UUID before calling this function"
);
`;
    expect(checkTenantGucViolations(source, false)).toEqual([]);
  });

  // ── PERF-013 review follow-up (Issue B): the multi-line lookahead window
  // must attribute a violation to the line the match actually starts on,
  // not the window's start (trigger) line — a harmless `SET
  // statement_timeout` line immediately preceding the real violation was
  // being reported at its own line with its own (non-matching) snippet
  // text, even though the violation message correctly named `app.tenant_id`
  // (on the next line). The old line-by-line guard (pre-PERF-013) did not
  // have this problem on the same input; this is a regression introduced
  // by the new window mechanism specifically. ──
  it("attributes line/snippet to the actual violating line, not a harmless SET line earlier in the lookahead window", () => {
    const source = `SET statement_timeout = '30s';
SET app.tenant_id = 'xyz';`;
    const violations = checkTenantGucViolations(source, true);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(2);
    expect(violations[0].snippet).toContain("app.tenant_id");
    expect(violations[0].snippet).not.toContain("statement_timeout");
  });

  // ── PERF-013 review follow-up (round 2): the isSql-gated TO pattern
  // above closed issue A's false positive but introduced a regression of
  // its own — gating bare TO on file extension also stops it from matching
  // TO-syntax raw SQL that's embedded in a .ts/.mjs file via a template
  // literal (e.g. handed to sql.unsafe(...)), the same embedding shape the
  // set_config(...) test above already covers. Fixed by requiring a
  // value-like token (a quote, `$`, or `:`) immediately after TO instead of
  // gating on isSql/file extension at all — this must now catch the
  // embedded case even though isSql is false here. ──
  it("reports raw `SET app.tenant_id TO '...'` embedded in a .ts template literal as a violation, even though isSql is false", () => {
    const source = `
await sql.unsafe(\`SET app.tenant_id TO '\${T}'\`);
`;
    const violations = checkTenantGucViolations(source, false);
    expect(violations).toHaveLength(1);
    expect(violations[0].snippet).toContain("SET app.tenant_id");
  });

  // ── PERF-013 review follow-up (round 4): round 3's fix above (the
  // quote/$/colon lookahead) closed issue A's false positive but has its
  // own residual gap — a BARE, unquoted value after TO starts with none of
  // those three characters, so it was silently missed. All three of the
  // following correctly triggered a violation before round 3's fix (i.e.
  // against bb64f216's parent), confirming a genuine regression rather than
  // a pre-existing gap. Fixed by ADDING a second value-start signal (a
  // bareword immediately closed by a statement terminator — see
  // RAW_SET_RE's comment above for the full rationale) alongside the
  // quote/$/colon lookahead, not replacing it — the false-positive
  // regression tests above/below must (and do) still pass unchanged. ──
  it("reports raw `SET app.tenant_id TO DEFAULT;` — a bare keyword value — as a violation", () => {
    const source = `SET app.tenant_id TO DEFAULT;`;
    const violations = checkTenantGucViolations(source, true);
    expect(violations).toHaveLength(1);
    expect(violations[0].snippet).toContain("SET app.tenant_id");
  });

  it("reports raw `SET app.tenant_id TO 5;` — a bare numeric value — as a violation", () => {
    const source = `SET app.tenant_id TO 5;`;
    const violations = checkTenantGucViolations(source, true);
    expect(violations).toHaveLength(1);
  });

  it("reports raw `SET app.tenant_id TO my_tenant_var;` — a bare identifier/variable reference, ordinary realistic PL/pgSQL — as a violation", () => {
    const source = `
DO $body$
BEGIN
  SET app.tenant_id TO my_tenant_var;
END
$body$;
`;
    const violations = checkTenantGucViolations(source, true);
    expect(violations).toHaveLength(1);
    expect(violations[0].snippet).toContain("SET app.tenant_id");
  });

  it("reports a bare TO value split onto its own line inside a multi-line .ts template literal (a real newline satisfies the terminator check)", () => {
    const source = `
await sql.unsafe(\`
  SET app.tenant_id TO DEFAULT
\`);
`;
    const violations = checkTenantGucViolations(source, false);
    expect(violations).toHaveLength(1);
  });

  // ── Round 4: DELIBERATELY ACCEPTED gap, documented rather than silently
  // left as a surprise (same convention discoverFiles() above uses for its
  // own out-of-scope set_config sites). A bareword value with NO terminator
  // at all immediately after it on the SAME line — here, a single-line
  // template literal with the trailing `;` omitted, so a bare backtick (not
  // `;`/newline) sits right after DEFAULT — is still missed. This is
  // intentional, not an oversight: including a bare backtick or `)` in the
  // terminator set would also match plausible English phrasing inside a
  // template-literal error message ending in "...to DEFAULT`)" with no
  // further words, reintroducing the exact false positive round 3 fixed.
  // This test asserts CURRENT (accepted-gap) behavior, not desired
  // behavior — if it ever starts failing because someone tightens the
  // regex further, that's a deliberate scope decision to revisit, not a
  // regression to silently paper over. ──
  it("[KNOWN GAP, accepted] does NOT catch a bare TO value with no terminator at all after it on the same line (e.g. a single-line template literal with the trailing `;` omitted)", () => {
    const source = `await sql.unsafe(\`SET app.tenant_id TO DEFAULT\`);`;
    const violations = checkTenantGucViolations(source, false);
    expect(violations).toEqual([]); // documented gap — see RAW_SET_RE's comment above
  });

  // ── Reviewer-flagged secondary issue (lower severity, non-blocking): a
  // multi-line string concatenation of ordinary, non-violating text that
  // itself contains the bare word SET (triggering the lookahead-window
  // check), immediately followed within that same window by a real
  // violation, used to report the real violation TWICE — a phantom,
  // mislocated extra one, plus the correct one — because
  // collapseConcatJoins() deleted the real physical newline inside the
  // join span, desyncing the line-offset count from the original `lines`
  // array. Fixed by preserving the join span's newline count instead of
  // always collapsing to "". ──
  it("does not double-report a real violation when a preceding multi-line concatenated non-violating string also contains the word SET", () => {
    const source = `logger.warn("a message about SET " +
  "configuration, nothing to see here");
SET app.tenant_id = 'real-value';`;
    const violations = checkTenantGucViolations(source, false);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(3);
    expect(violations[0].snippet).toContain("app.tenant_id");
  });
});

describe("raw-session-guc-guard: checkAdvisoryLockViolations()", () => {
  it("reports a session-scoped pg_advisory_lock as a violation (the hrms-service fixture's pre-fix shape)", () => {
    const source = `await sql.unsafe(\`select pg_advisory_lock(\${SEED_LOCK_KEY})\`);`;
    const violations = checkAdvisoryLockViolations(source, false);
    expect(violations).toHaveLength(1);
  });

  it("reports pg_try_advisory_lock_shared as a violation", () => {
    const source = `SELECT pg_try_advisory_lock_shared(42);`;
    expect(checkAdvisoryLockViolations(source, true)).toHaveLength(1);
  });

  it("does NOT flag pg_advisory_xact_lock (transaction-scoped, the fixed pattern)", () => {
    const source = `await tx.unsafe(\`select pg_advisory_xact_lock(\${SEED_LOCK_KEY})\`);`;
    expect(checkAdvisoryLockViolations(source, false)).toEqual([]);
  });

  it("does NOT flag pg_advisory_unlock (releasing, not acquiring)", () => {
    const source = `select pg_advisory_unlock(918273645);`;
    expect(checkAdvisoryLockViolations(source, true)).toEqual([]);
  });
});
