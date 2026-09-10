import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanSource } from "./scanner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, "__fixtures__", name), "utf8");
}

describe("scanSource (UX-004 extraction tool)", () => {
  it("reports every hardcoded string in the hardcoded fixture", () => {
    const source = loadFixture("hardcoded.fixture.tsx");
    const findings = scanSource("hardcoded.fixture.tsx", source);
    const texts = findings.map((f) => f.text);

    expect(texts).toContain("Welcome to the dashboard");
    expect(texts).toContain("Submit");
    expect(texts).toContain("Submit the form");
    expect(texts).toContain("Enter your name");
    expect(texts).toContain("No records found");

    // title + aria-label both carry "Submit the form" -> 2 prop findings.
    const submitTitleHits = findings.filter((f) => f.text === "Submit the form");
    expect(submitTitleHits).toHaveLength(2);
    expect(submitTitleHits.map((f) => f.prop).sort()).toEqual(["aria-label", "title"]);

    // Every finding must carry a real line number pointing back into the file.
    for (const f of findings) {
      expect(f.line).toBeGreaterThan(0);
      expect(f.file).toBe("hardcoded.fixture.tsx");
    }

    expect(findings.length).toBeGreaterThanOrEqual(5);
  });

  it("reports zero findings for a fully-externalized (t()-only) fixture", () => {
    const source = loadFixture("clean.fixture.tsx");
    const findings = scanSource("clean.fixture.tsx", source);
    expect(findings).toEqual([]);
  });

  it("ignores non-user-facing prop names even when they hold literal strings", () => {
    const source = `
      <div className="card grid-4" data-testid="row-1" role="listitem">
        <a href="/finance/dashboard" rel="noopener">{t("link")}</a>
      </div>
    `;
    expect(scanSource("x.tsx", source)).toEqual([]);
  });

  it("ignores asset paths, URLs, and constant-like values in tracked props", () => {
    const source = `
      <img alt="/icons/logo.svg" title="https://example.gov.in" />
      <span label="ACTIVE_STATUS" />
    `;
    expect(scanSource("x.tsx", source)).toEqual([]);
  });

  it("flags a genuinely hardcoded tracked-prop string others miss (description)", () => {
    const source = `<Card description="Budget, expenditure, receipts and treasury." />`;
    const findings = scanSource("x.tsx", source);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "prop", prop: "description" });
  });
});
