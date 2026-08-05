/**
 * Formula engine — evaluates computed columns on report rows.
 * Recursive descent parser: +, -, *, /, % (modulo), field refs, numeric literals, parens.
 * No external deps. Division by zero → null, missing field → null, type mismatch → null.
 * Never throws, never returns NaN.
 */

export interface Formula {
  name: string;
  expression: string;
  type: "number" | "percentage" | "currency";
}

type TokenKind = "number" | "ident" | "op" | "lparen" | "rparen" | "end";
interface Token { kind: TokenKind; value: string }

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i]!;
    if (ch === " " || ch === "\t") { i++; continue; }
    if (ch === "(") { tokens.push({ kind: "lparen", value: "(" }); i++; continue; }
    if (ch === ")") { tokens.push({ kind: "rparen", value: ")" }); i++; continue; }
    if ("+-*/%".includes(ch)) { tokens.push({ kind: "op", value: ch }); i++; continue; }
    if (ch >= "0" && ch <= "9" || ch === ".") {
      let num = "";
      while (i < expr.length && (expr[i]! >= "0" && expr[i]! <= "9" || expr[i] === ".")) { num += expr[i]!; i++; }
      tokens.push({ kind: "number", value: num }); continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let id = "";
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i]!)) { id += expr[i]!; i++; }
      tokens.push({ kind: "ident", value: id }); continue;
    }
    i++;
  }
  tokens.push({ kind: "end", value: "" });
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(private tokens: Token[], private row: Record<string, unknown>) {}
  private peek(): Token { return this.tokens[this.pos] ?? { kind: "end", value: "" }; }
  private advance(): Token { return this.tokens[this.pos++] ?? { kind: "end", value: "" }; }

  parse(): number | null { return this.addSub(); }

  private addSub(): number | null {
    let left = this.mulDivMod();
    if (left === null) return null;
    while (this.peek().kind === "op" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.advance().value;
      const right = this.mulDivMod();
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  private mulDivMod(): number | null {
    let left = this.unary();
    if (left === null) return null;
    while (this.peek().kind === "op" && (this.peek().value === "*" || this.peek().value === "/" || this.peek().value === "%")) {
      const op = this.advance().value;
      const right = this.unary();
      if (right === null) return null;
      if ((op === "/" || op === "%") && right === 0) return null;
      if (op === "*") left = left * right;
      else if (op === "/") left = left / right;
      else left = left % right;
    }
    return left;
  }

  private unary(): number | null {
    if (this.peek().kind === "op" && this.peek().value === "-") { this.advance(); const v = this.primary(); return v === null ? null : -v; }
    if (this.peek().kind === "op" && this.peek().value === "+") { this.advance(); return this.primary(); }
    return this.primary();
  }

  private primary(): number | null {
    const tok = this.peek();
    if (tok.kind === "number") { this.advance(); const n = Number(tok.value); return Number.isFinite(n) ? n : null; }
    if (tok.kind === "ident") {
      this.advance();
      const val = this.row[tok.value];
      if (val === undefined || val === null) return null;
      const n = Number(val);
      return Number.isFinite(n) ? n : null;
    }
    if (tok.kind === "lparen") {
      this.advance();
      const inner = this.addSub();
      if (this.peek().kind === "rparen") this.advance();
      return inner;
    }
    return null;
  }
}

function evaluateSingle(expression: string, row: Record<string, unknown>): number | null {
  const tokens = tokenize(expression);
  const parser = new Parser(tokens, row);
  const result = parser.parse();
  return result === null || !Number.isFinite(result) ? null : result;
}

/** Evaluate formulas against each row, appending computed columns. */
export function evaluateFormulas(rows: Record<string, unknown>[], formulas: Formula[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const extended = { ...row };
    for (const formula of formulas) { extended[formula.name] = evaluateSingle(formula.expression, extended); }
    return extended;
  });
}

/** Format a computed value according to its formula type. */
export function formatFormulaValue(value: unknown, type: Formula["type"], locale = "en-IN"): string | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  switch (type) {
    case "percentage": return `${num}%`;
    case "currency": return num.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "number": default: return String(num);
  }
}
