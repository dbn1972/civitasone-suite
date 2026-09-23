/**
 * stat-tile-literal-guard.mjs — fixture-based unit tests.
 *
 * Exercises the exported `checkStatTileLiteralViolations()` directly
 * against in-memory source strings, mirroring
 * tests/architecture/raw-status-leak-guard.test.ts's shape, plus two
 * on-disk fixture files (tests/architecture/fixtures/stat-tile-literal/)
 * that model the real #1472 sa-dashboard defect and its fix end-to-end.
 *
 * Run: pnpm exec vitest run tests/architecture/stat-tile-literal-guard.test.ts
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkStatTileLiteralViolations } from "../../scripts/ci/stat-tile-literal-guard.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, "fixtures", "stat-tile-literal");

describe("stat-tile-literal-guard: checkStatTileLiteralViolations()", () => {
  it('flags a hardcoded string literal value prop (the #1472 Services exemplar: value="33")', () => {
    const source = `<StatCard icon="📊" iconBg="#eff6ff" label="Services" value="33" />`;
    const violations = checkStatTileLiteralViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(1);
    expect(violations[0].reason).toMatch(/hardcoded literal \("33"\)/);
    expect(violations[0].reason).toMatch(/Services/);
  });

  it('flags a hardcoded percentage literal (the #1472 Uptime exemplar shape: value="99.9%")', () => {
    const source = `<StatCard icon="💚" label="Platform Uptime" value="99.9%" />`;
    expect(checkStatTileLiteralViolations(source)).toHaveLength(1);
  });

  it("flags a bare numeric literal passed as an expression (value={33})", () => {
    const source = `<StatCard label="Services" value={33} />`;
    expect(checkStatTileLiteralViolations(source)).toHaveLength(1);
  });

  it('flags a quoted string literal passed as an expression (value={"33"})', () => {
    const source = `<StatCard label="Services" value={"33"} />`;
    expect(checkStatTileLiteralViolations(source)).toHaveLength(1);
  });

  it('flags a unit-suffixed literal (value="8 hrs") -- digit-leading is the signal, not pure-numeric', () => {
    const source = `<StatCard label="Std Hours" value="8 hrs" />`;
    expect(checkStatTileLiteralViolations(source)).toHaveLength(1);
  });

  it('flags a currency-prefixed literal (value="₹42,000")', () => {
    const source = `<StatCard label="Revenue" value="₹42,000" />`;
    expect(checkStatTileLiteralViolations(source)).toHaveLength(1);
  });

  it("flags a negative numeric literal (value={-5})", () => {
    const source = `<StatCard label="Net Change" value={-5} />`;
    expect(checkStatTileLiteralViolations(source)).toHaveLength(1);
  });

  it("flags each hardcoded value inside a StatCardGrid items array literal", () => {
    const source = `
      <StatCardGrid items={[
        { label: "Active Tenants", value: "128" },
        { label: "Uptime", value: "99.9%" },
      ]} />
    `;
    const violations = checkStatTileLiteralViolations(source);
    expect(violations).toHaveLength(2);
  });

  it("does NOT flag a value bound to an identifier (the real fix shape: value={tenants})", () => {
    const source = `<StatCard label="Active Tenants" value={tenants} />`;
    expect(checkStatTileLiteralViolations(source)).toEqual([]);
  });

  it('does NOT flag the honest "—" placeholder fallback (value={uptime ?? "—"})', () => {
    const source = `<StatCard label="Platform Uptime" value={uptime ?? "—"} />`;
    expect(checkStatTileLiteralViolations(source)).toEqual([]);
  });

  it('does NOT flag a bare honest placeholder literal (value="—")', () => {
    const source = `<StatCard label="Platform Uptime" value="—" />`;
    expect(checkStatTileLiteralViolations(source)).toEqual([]);
  });

  it("does NOT flag a member/computed expression (value={ops.summary.online})", () => {
    const source = `<StatCard label="Services" value={ops.summary.online} />`;
    expect(checkStatTileLiteralViolations(source)).toEqual([]);
  });

  it('does NOT flag a ternary derived from a real condition, even with a literal branch (value={opsUnavailable ? "—" : servicesLabel})', () => {
    const source = `<StatCard label="Services" value={opsUnavailable ? "—" : servicesLabel} />`;
    expect(checkStatTileLiteralViolations(source)).toEqual([]);
  });

  it("does NOT flag a template literal with a real substitution (value={`${online}/${total}`})", () => {
    const source = "<StatCard label=\"Services\" value={`${online}/${total}`} />";
    expect(checkStatTileLiteralViolations(source)).toEqual([]);
  });

  it("does NOT flag an items array bound to a variable, not written inline (StatCardGrid items={ROWS})", () => {
    const source = `<StatCardGrid items={ROWS} />`;
    expect(checkStatTileLiteralViolations(source)).toEqual([]);
  });

  it("does NOT flag an items array built via .map() from real data", () => {
    const source = `<StatCardGrid items={rows.map((r) => ({ label: r.label, value: r.value }))} />`;
    expect(checkStatTileLiteralViolations(source)).toEqual([]);
  });

  it("does NOT flag an unrelated component that merely contains the word Card (NavCard, ApprovalCard)", () => {
    const source = `<NavCard label="Go to Assets" value="42" />\n<ApprovalCard label="Pending" value="7" />`;
    expect(checkStatTileLiteralViolations(source)).toEqual([]);
  });

  it("does NOT flag plain static JSX text -- headings, button labels, help copy -- on unrelated elements", () => {
    const source = `
      <div>
        <h1>Platform Overview</h1>
        <p>Live counts pulled from the admin service every load.</p>
        <button type="button">Refresh</button>
      </div>
    `;
    expect(checkStatTileLiteralViolations(source)).toEqual([]);
  });

  it('respects the "static reference" escape-hatch comment (same convention as screen-map.mjs)', () => {
    const source = `
      {/* static reference: fixed policy constant, same for every tenant */}
      <StatCard label="Std Hours" value="8 hrs" />
    `;
    expect(checkStatTileLiteralViolations(source)).toEqual([]);
  });

  it("still flags a hardcoded literal on a DIFFERENT nearby StatCard the marker doesn't cover", () => {
    const source = `
      {/* static reference: fixed policy constant, same for every tenant */}
      <StatCard label="Std Hours" value="8 hrs" />
      <StatCard label="Services" value="33" />
    `;
    const violations = checkStatTileLiteralViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toMatch(/Services/);
  });

  it('does NOT flag a legitimate marked static constant (label="Free Tier Storage" value="5 GB")', () => {
    const source = `
      {/* static reference: fixed plan constant, same for every tenant */}
      <StatCard label="Free Tier Storage" value="5 GB" />
    `;
    expect(checkStatTileLiteralViolations(source)).toEqual([]);
  });
});

// PR #1486 review follow-up: the guard's JSX-attribute-site check is, by
// design, a single-hop analysis (see the file header's "deliberately does
// not catch") -- but "single hop" was being measured inconsistently. These
// four shapes are each exactly one hop away from a bare literal, no
// cross-variable data-flow tracing required, and were invisible before this
// fix even though the header already documented ternary/template/`??` as
// "treated as data-bound" without actually checking what was inside them.
// Each reproduces the reviewer's own fixture against
// checkStatTileLiteralViolations() using the exact literal values ("99.9%",
// "33") from the real #1472 bug this guard exists to catch.
describe("stat-tile-literal-guard: one-hop-removed fabricated literals (PR #1486 review follow-up)", () => {
  it('flags a template substitution that is itself a bare literal (value={`${"99.9"}%`}) -- reviewer gap #1', () => {
    const source = '<StatCard label="Platform Uptime" value={`${"99.9"}%`} />';
    const violations = checkStatTileLiteralViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toMatch(/hardcoded literal \("99\.9%"\)/);
  });

  it('flags a ternary with one fabricated branch next to one real branch (value={isDemo ? "99.9%" : liveUptime}) -- reviewer gap #2', () => {
    const source = `<StatCard label="Platform Uptime" value={isDemo ? "99.9%" : liveUptime} />`;
    const violations = checkStatTileLiteralViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toMatch(/hardcoded literal \("99\.9%"\)/);
  });

  it('flags a `??` fallback whose literal side is a fabricated metric, NOT the honest placeholder (value={data?.uptime ?? "99.9%"}) -- reviewer gap #3', () => {
    const source = `<StatCard label="Platform Uptime" value={data?.uptime ?? "99.9%"} />`;
    const violations = checkStatTileLiteralViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toMatch(/hardcoded literal \("99\.9%"\)/);
  });

  it('flags a dead-left-side `??` fallback that always evaluates to the literal (value={undefined ?? "33"}) -- reviewer gap #4', () => {
    const source = `<StatCard label="Services" value={undefined ?? "33"} />`;
    const violations = checkStatTileLiteralViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toMatch(/hardcoded literal \("33"\)/);
  });

  it('flags the same fallback mechanism via `||`, not just `??` (value={liveCount || "33"})', () => {
    const source = `<StatCard label="Services" value={liveCount || "33"} />`;
    const violations = checkStatTileLiteralViolations(source);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toMatch(/hardcoded literal \("33"\)/);
  });

  it('does NOT flag a `||` fallback whose literal side is the honest placeholder (value={uptime || "—"})', () => {
    const source = `<StatCard label="Platform Uptime" value={uptime || "—"} />`;
    expect(checkStatTileLiteralViolations(source)).toEqual([]);
  });

  it("flags a fabricated literal one hop inside a StatCardGrid array entry, not just a bare StatCard value prop", () => {
    const source = `
      <StatCardGrid items={[
        { label: "Platform Uptime", value: isDemo ? "99.9%" : liveUptime },
      ]} />
    `;
    const violations = checkStatTileLiteralViolations(source);
    expect(violations).toHaveLength(1);
  });
});

describe("stat-tile-literal-guard: on-disk fixtures", () => {
  it("flags every hardcoded stat tile in the violation fixture, with no false negatives", () => {
    const source = readFileSync(join(FIXTURES_DIR, "violation.tsx"), "utf8");
    const violations = checkStatTileLiteralViolations(source, "violation.tsx");
    // 2 direct StatCard literals + 2 StatCardGrid array-entry literals.
    expect(violations).toHaveLength(4);
    expect(violations.some((v) => v.reason.includes("Services"))).toBe(true);
    expect(violations.some((v) => v.snippet.includes("99.9%"))).toBe(true);
    expect(violations.some((v) => v.snippet.includes("128"))).toBe(true);
    expect(violations.some((v) => v.snippet.includes("0.2%"))).toBe(true);
  });

  it("does NOT flag anything in the clean, real-data-bound fixture", () => {
    const source = readFileSync(join(FIXTURES_DIR, "clean.tsx"), "utf8");
    const violations = checkStatTileLiteralViolations(source, "clean.tsx");
    expect(violations).toEqual([]);
  });
});
