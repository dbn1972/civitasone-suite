import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/**
 * GAP-HR-ADVANCES-07 guard: user-facing text in app/(app)/hr/advances must
 * come from next-intl (advances.* keys), never from a JSX text node or a
 * user-facing string prop. The page, form, confirm dialogs, error boundary and
 * loading boundary had each grown English literals ("Back to HR", "Approve",
 * "Couldn't load...") that a Hindi-locale user saw verbatim.
 *
 * It walks the real TypeScript AST of every non-test source file in this
 * folder and fails on:
 *   - JSX text containing a word (two or more ASCII letters), and
 *   - a string literal given to a known user-facing prop (title, label,
 *     aria-label, placeholder, backLabel, message, confirmLabel, ...), or
 *     placed directly in a JSX expression container ({"Text"}).
 * Strings like "—", emoji and CSS/`className` values carry no word and pass.
 */
const DIR = __dirname;

const USER_FACING_PROPS = new Set([
  "title", "label", "aria-label", "aria-description", "placeholder", "backLabel", "message", "confirmLabel",
  "cancelLabel", "description", "alt", "emptyTitle", "emptyMessage", "filterPlaceholder", "reasonLabel",
  "errorMessage", "subtitle", "area", "hint", "helperText", "tooltip",
]);

const HAS_WORD = /[A-Za-z]{2,}/;

function sourceFiles(): string[] {
  return readdirSync(DIR)
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.(test|guard\.test)\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts"))
    .sort();
}

type Violation = { file: string; line: number; text: string };

function findViolations(file: string): Violation[] {
  const full = path.join(DIR, file);
  const text = readFileSync(full, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Violation[] = [];
  const at = (node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  function visit(node: ts.Node): void {
    if (ts.isJsxText(node)) {
      const t = node.getText(sf).trim();
      if (t && HAS_WORD.test(t)) out.push({ file, line: at(node), text: t });
    } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const name = node.name.getText(sf);
      if (USER_FACING_PROPS.has(name) && HAS_WORD.test(node.initializer.text)) {
        out.push({ file, line: at(node), text: `${name}="${node.initializer.text}"` });
      }
    } else if (ts.isJsxExpression(node) && node.expression && (ts.isStringLiteral(node.expression) || ts.isNoSubstitutionTemplateLiteral(node.expression))) {
      // {"Text"} as a child (an attribute value in an expression container is handled below)
      if (!ts.isJsxAttribute(node.parent) && HAS_WORD.test(node.expression.text)) {
        out.push({ file, line: at(node), text: `{"${node.expression.text}"}` });
      }
    } else if (
      ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression &&
      (ts.isStringLiteral(node.initializer.expression) || ts.isNoSubstitutionTemplateLiteral(node.initializer.expression))
    ) {
      const name = node.name.getText(sf);
      if (USER_FACING_PROPS.has(name) && HAS_WORD.test(node.initializer.expression.text)) {
        out.push({ file, line: at(node), text: `${name}={"${node.initializer.expression.text}"}` });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return out;
}

describe("hr/advances has no hard-coded user-facing English (GAP-HR-ADVANCES-07)", () => {
  const files = sourceFiles();

  it("scans the real source files of the folder", () => {
    expect(files).toEqual(expect.arrayContaining(["page.tsx", "RequestAdvanceForm.tsx", "ApproveAdvanceButton.tsx", "error.tsx", "loading.tsx", "mapAdvances.ts"]));
  });

  it.each(files)("%s", (file) => {
    const violations = findViolations(file);
    expect(violations, violations.map((v) => `${v.file}:${v.line}  ${v.text}`).join("\n")).toEqual([]);
  });

  it("the detector itself flags the literals it exists to catch (sanity)", () => {
    const sample = ts.createSourceFile("x.tsx", `const a = <Foo backLabel="Back to HR" title={"Approve this?"}>Approve<b>{"Hi there"}</b></Foo>;`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let hits = 0;
    const walk = (n: ts.Node): void => {
      if (ts.isJsxText(n) && HAS_WORD.test(n.getText(sample))) hits++;
      if (ts.isJsxAttribute(n) && USER_FACING_PROPS.has(n.name.getText(sample))) hits++;
      if (ts.isJsxExpression(n) && n.expression && ts.isStringLiteral(n.expression) && !ts.isJsxAttribute(n.parent)) hits++;
      ts.forEachChild(n, walk);
    };
    walk(sample);
    expect(hits).toBeGreaterThanOrEqual(4);
  });
});
