/**
 * Safe, dependency-free evaluator for edge condition expressions against an
 * instance context (jsonb). Intentionally tiny: NO eval, NO Function — a
 * hand-written recursive-descent parser only.
 *
 * Grammar (boolean expression over comparisons):
 *   expr    := orExpr
 *   orExpr  := andExpr ( ("OR" | "||") andExpr )*
 *   andExpr := notExpr ( ("AND" | "&&") notExpr )*
 *   notExpr := ("NOT" | "!") notExpr | primary
 *   primary := "(" expr ")" | comparison | boolLit
 *   comparison := field op rhs
 *   field   := dotted path into context, e.g. "amount" or "request.priority"
 *   op      := == | != | > | >= | < | <= | in
 *   rhs     := number | 'string' | "string" | true | false | null |
 *              bare-token | [a, b, c]  (for `in`)
 *   boolLit := true | false
 *
 * A null/empty condition is unconditional (always true). Backward compatible:
 * a single bare comparison parses to one comparison node.
 */

export function normalizeContext(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return {};
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------
type Tok =
  | { k: "lparen" }
  | { k: "rparen" }
  | { k: "and" }
  | { k: "or" }
  | { k: "not" }
  | { k: "op"; v: string }
  | { k: "lbracket" }
  | { k: "rbracket" }
  | { k: "comma" }
  | { k: "ident"; v: string }   // dotted field path or bare token
  | { k: "num"; v: string }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "null" };

class ConditionError extends Error {}

function tokenize(input: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const c = input[i]!;
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (c === "(") { toks.push({ k: "lparen" }); i++; continue; }
    if (c === ")") { toks.push({ k: "rparen" }); i++; continue; }
    if (c === "[") { toks.push({ k: "lbracket" }); i++; continue; }
    if (c === "]") { toks.push({ k: "rbracket" }); i++; continue; }
    if (c === ",") { toks.push({ k: "comma" }); i++; continue; }
    // string literals
    if (c === "'" || c === '"') {
      const quote = c;
      let j = i + 1;
      let s = "";
      while (j < n && input[j] !== quote) { s += input[j]; j++; }
      if (j >= n) throw new ConditionError("unterminated string literal");
      toks.push({ k: "str", v: s });
      i = j + 1;
      continue;
    }
    // logical / comparison operators (symbolic)
    if (c === "&" && input[i + 1] === "&") { toks.push({ k: "and" }); i += 2; continue; }
    if (c === "|" && input[i + 1] === "|") { toks.push({ k: "or" }); i += 2; continue; }
    if (c === "!" && input[i + 1] === "=") { toks.push({ k: "op", v: "!=" }); i += 2; continue; }
    if (c === "!") { toks.push({ k: "not" }); i++; continue; }
    if (c === "=" && input[i + 1] === "=") { toks.push({ k: "op", v: "==" }); i += 2; continue; }
    if (c === ">" && input[i + 1] === "=") { toks.push({ k: "op", v: ">=" }); i += 2; continue; }
    if (c === "<" && input[i + 1] === "=") { toks.push({ k: "op", v: "<=" }); i += 2; continue; }
    if (c === ">") { toks.push({ k: "op", v: ">" }); i++; continue; }
    if (c === "<") { toks.push({ k: "op", v: "<" }); i++; continue; }
    // numbers (incl. negative + decimal)
    if (/[0-9]/.test(c) || (c === "-" && /[0-9]/.test(input[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < n && /[0-9.]/.test(input[j]!)) j++;
      toks.push({ k: "num", v: input.slice(i, j) });
      i = j;
      continue;
    }
    // identifiers / keywords / dotted paths / bare tokens
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_.]/.test(input[j]!)) j++;
      const word = input.slice(i, j);
      const lower = word.toLowerCase();
      if (lower === "and") toks.push({ k: "and" });
      else if (lower === "or") toks.push({ k: "or" });
      else if (lower === "not") toks.push({ k: "not" });
      else if (lower === "in") toks.push({ k: "op", v: "in" });
      else if (lower === "true") toks.push({ k: "bool", v: true });
      else if (lower === "false") toks.push({ k: "bool", v: false });
      else if (lower === "null") toks.push({ k: "null" });
      else toks.push({ k: "ident", v: word });
      i = j;
      continue;
    }
    throw new ConditionError(`unexpected character '${c}' at ${i}`);
  }
  return toks;
}

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------
type Node =
  | { t: "and"; l: Node; r: Node }
  | { t: "or"; l: Node; r: Node }
  | { t: "not"; e: Node }
  | { t: "cmp"; path: string; op: string; rhs: Literal | Literal[] }
  | { t: "lit"; v: boolean };

type Literal = string | number | boolean | null;

class Parser {
  private pos = 0;
  constructor(private toks: Tok[]) {}

  private peek(): Tok | undefined { return this.toks[this.pos]; }
  private next(): Tok | undefined { return this.toks[this.pos++]; }

  parse(): Node {
    const node = this.parseOr();
    if (this.pos !== this.toks.length) throw new ConditionError("unexpected trailing tokens");
    return node;
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (this.peek()?.k === "or") {
      this.next();
      const right = this.parseAnd();
      left = { t: "or", l: left, r: right };
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseNot();
    while (this.peek()?.k === "and") {
      this.next();
      const right = this.parseNot();
      left = { t: "and", l: left, r: right };
    }
    return left;
  }

  private parseNot(): Node {
    if (this.peek()?.k === "not") {
      this.next();
      return { t: "not", e: this.parseNot() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Node {
    const tok = this.peek();
    if (!tok) throw new ConditionError("unexpected end of expression");
    if (tok.k === "lparen") {
      this.next();
      const inner = this.parseOr();
      if (this.peek()?.k !== "rparen") throw new ConditionError("missing closing parenthesis");
      this.next();
      return inner;
    }
    if (tok.k === "bool") { this.next(); return { t: "lit", v: tok.v }; }
    // a comparison: field op rhs
    if (tok.k === "ident") {
      const path = tok.v;
      this.next();
      const opTok = this.next();
      if (!opTok || opTok.k !== "op") throw new ConditionError(`expected comparison operator after '${path}'`);
      const op = opTok.v;
      if (op === "in") {
        const list = this.parseList();
        return { t: "cmp", path, op, rhs: list };
      }
      const rhs = this.parseScalar();
      return { t: "cmp", path, op, rhs };
    }
    throw new ConditionError("expected a comparison or '('");
  }

  private parseScalar(): Literal {
    const tok = this.next();
    if (!tok) throw new ConditionError("expected a value");
    switch (tok.k) {
      case "num": return Number(tok.v);
      case "str": return tok.v;
      case "bool": return tok.v;
      case "null": return null;
      case "ident": return tok.v; // bare token compared as string
      default: throw new ConditionError("invalid right-hand value");
    }
  }

  private parseList(): Literal[] {
    if (this.next()?.k !== "lbracket") throw new ConditionError("'in' expects a [list]");
    const out: Literal[] = [];
    if (this.peek()?.k === "rbracket") { this.next(); return out; }
    for (;;) {
      out.push(this.parseScalar());
      const sep = this.next();
      if (sep?.k === "rbracket") break;
      if (sep?.k !== "comma") throw new ConditionError("expected ',' or ']' in list");
    }
    return out;
  }
}

function parse(expr: string): Node {
  return new Parser(tokenize(expr)).parse();
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------
function evalNode(node: Node, ctx: Record<string, unknown>): boolean {
  switch (node.t) {
    case "lit": return node.v;
    case "not": return !evalNode(node.e, ctx);
    case "and": return evalNode(node.l, ctx) && evalNode(node.r, ctx);
    case "or": return evalNode(node.l, ctx) || evalNode(node.r, ctx);
    case "cmp": {
      const lhs = resolvePath(ctx, node.path);
      if (node.op === "in") {
        const list = node.rhs as Literal[];
        return list.some((v) => looseEq(lhs, v));
      }
      const rhs = node.rhs as Literal;
      switch (node.op) {
        case "==": return looseEq(lhs, rhs);
        case "!=": return !looseEq(lhs, rhs);
        case ">": return numCmp(lhs, rhs) > 0;
        case ">=": return numCmp(lhs, rhs) >= 0;
        case "<": return numCmp(lhs, rhs) < 0;
        case "<=": return numCmp(lhs, rhs) <= 0;
        default: return false;
      }
    }
  }
}

/**
 * Evaluate an edge condition. A null/empty/`true` condition is unconditional.
 * A MALFORMED expression returns false at runtime (fail-closed); malformed
 * expressions are caught earlier by validateCondition() at deploy time so this
 * runtime fallback should never be hit for a deployed definition.
 */
export function evaluateCondition(
  expr: string | null | undefined,
  context: Record<string, unknown>,
): boolean {
  if (expr === null || expr === undefined) return true;
  const trimmed = expr.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "true") return true;
  if (trimmed.toLowerCase() === "false") return false;
  try {
    return evalNode(parse(trimmed), context);
  } catch {
    return false; // fail closed on a malformed expression
  }
}

/**
 * Validate an edge condition expression at DEPLOY time. Returns an error string
 * if the expression is malformed, else null. Used by validateGraph so a
 * malformed condition is rejected at validation, never silently false at
 * runtime. An empty / true / false literal is always valid.
 */
export function validateCondition(expr: string | null | undefined): string | null {
  if (expr === null || expr === undefined) return null;
  const trimmed = expr.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "true" || trimmed.toLowerCase() === "false") return null;
  try {
    parse(trimmed);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "invalid condition";
  }
}

function resolvePath(ctx: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc !== null && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, ctx);
}

function looseEq(a: unknown, b: unknown): boolean {
  if (typeof a === "number" || typeof b === "number") {
    return Number(a) === Number(b);
  }
  if (typeof a === "boolean" || typeof b === "boolean") {
    return String(a) === String(b);
  }
  return String(a) === String(b);
}

function numCmp(a: unknown, b: unknown): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isNaN(na) || Number.isNaN(nb)) return -1; // non-numeric: treat as not-greater
  return na - nb;
}
