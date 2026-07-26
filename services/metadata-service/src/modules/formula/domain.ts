/**
 * Metadata calculation / formula engine (CAP-113).
 *
 * A safe, side-effect-free expression evaluator that returns a VALUE (number,
 * string, or boolean) — distinct from the boolean validation-rule engine in
 * `modules/rules/domain.ts`. Used for computed fields and ad-hoc calculations.
 *
 * Grammar (recursive descent, precedence-climbing):
 *   or        := and ("OR" and)*
 *   and       := comparison ("AND" comparison)*
 *   comparison:= additive (("=="|"!="|">"|"<"|">="|"<=") additive)?
 *   additive  := multiplicative (("+"|"-") multiplicative)*
 *   multiplicative := unary (("*"|"/"|"%") unary)*
 *   unary     := ("-"|"NOT") unary | primary
 *   primary   := NUMBER | STRING | BOOL | NULL | field | func "(" args ")" | "(" or ")"
 *
 * Functions: ROUND, ABS, MIN, MAX, CEIL, FLOOR, SQRT, POW, LEN, UPPER, LOWER,
 *            CONCAT, IF, COALESCE, ISBLANK.
 *
 * Safe by construction: NO eval(), NO property access, NO arbitrary JS. Field
 * references are resolved from a plain data object only. Input is bounded in
 * length and recursion depth.
 */

export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormulaError";
  }
}

export type FormulaValue = number | string | boolean | null;

const MAX_EXPR_LENGTH = 2000;
const MAX_DEPTH = 64;

type TokType = "num" | "str" | "ident" | "op" | "paren" | "comma";
interface Tok { type: TokType; value: string }

const MULTI_OPS = ["==", "!=", ">=", "<="];
const SINGLE_OPS = new Set(["+", "-", "*", "/", "%", ">", "<"]);
const FUNCS = new Set([
  "ROUND", "ABS", "MIN", "MAX", "CEIL", "FLOOR", "SQRT", "POW",
  "LEN", "UPPER", "LOWER", "CONCAT", "IF", "COALESCE", "ISBLANK",
]);

function tokenize(expr: string): Tok[] {
  if (expr.length > MAX_EXPR_LENGTH) throw new FormulaError("expression too long");
  const toks: Tok[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (c === "(" || c === ")") { toks.push({ type: "paren", value: c }); i++; continue; }
    if (c === ",") { toks.push({ type: "comma", value: "," }); i++; continue; }
    if (c === '"' || c === "'") {
      const q = c; let s = ""; i++;
      while (i < expr.length && expr[i] !== q) { s += expr[i]; i++; }
      if (i >= expr.length) throw new FormulaError("unterminated string literal");
      i++;
      toks.push({ type: "str", value: s });
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(expr[i + 1] ?? ""))) {
      let n = ""; let seenDot = false;
      while (i < expr.length && (/[0-9]/.test(expr[i]!) || (expr[i] === "." && !seenDot))) {
        if (expr[i] === ".") seenDot = true;
        n += expr[i]; i++;
      }
      toks.push({ type: "num", value: n });
      continue;
    }
    const two = expr.slice(i, i + 2);
    if (MULTI_OPS.includes(two)) { toks.push({ type: "op", value: two }); i += 2; continue; }
    if (c === "=") { toks.push({ type: "op", value: "==" }); i++; continue; } // treat single = as equality
    if (SINGLE_OPS.has(c)) { toks.push({ type: "op", value: c }); i++; continue; }
    if (/[A-Za-z_]/.test(c)) {
      let id = "";
      while (i < expr.length && /[A-Za-z0-9_]/.test(expr[i]!)) { id += expr[i]; i++; }
      const up = id.toUpperCase();
      if (up === "AND" || up === "OR" || up === "NOT") toks.push({ type: "op", value: up });
      else if (up === "TRUE" || up === "FALSE" || up === "NULL") toks.push({ type: "ident", value: up });
      else if (FUNCS.has(up)) toks.push({ type: "ident", value: up });
      else toks.push({ type: "ident", value: id });
      continue;
    }
    throw new FormulaError(`unexpected character: ${c}`);
  }
  return toks;
}

function toNum(v: FormulaValue): number {
  if (v === null) return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(n)) throw new FormulaError(`not a number: ${String(v)}`);
  return n;
}

function truthy(v: FormulaValue): boolean {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return v !== "";
}

function applyFunc(name: string, args: FormulaValue[]): FormulaValue {
  switch (name) {
    case "ABS": return Math.abs(toNum(args[0] ?? null));
    case "ROUND": {
      const digits = args[1] !== undefined ? toNum(args[1]) : 0;
      const f = Math.pow(10, digits);
      return Math.round(toNum(args[0] ?? null) * f) / f;
    }
    case "CEIL": return Math.ceil(toNum(args[0] ?? null));
    case "FLOOR": return Math.floor(toNum(args[0] ?? null));
    case "SQRT": {
      const x = toNum(args[0] ?? null);
      if (x < 0) throw new FormulaError("SQRT of negative");
      return Math.sqrt(x);
    }
    case "POW": return Math.pow(toNum(args[0] ?? null), toNum(args[1] ?? null));
    case "MIN": return Math.min(...args.map(toNum));
    case "MAX": return Math.max(...args.map(toNum));
    case "LEN": return args[0] == null ? 0 : String(args[0]).length;
    case "UPPER": return String(args[0] ?? "").toUpperCase();
    case "LOWER": return String(args[0] ?? "").toLowerCase();
    case "CONCAT": return args.map((a) => (a == null ? "" : String(a))).join("");
    case "ISBLANK": return args[0] === null || args[0] === undefined || args[0] === "";
    case "COALESCE": return args.find((a) => a !== null && a !== undefined && a !== "") ?? null;
    case "IF": return truthy(args[0] ?? null) ? (args[1] ?? null) : (args[2] ?? null);
    default: throw new FormulaError(`unknown function: ${name}`);
  }
}

/**
 * Evaluate a formula expression against a plain data context.
 * Returns a value; throws FormulaError on malformed input.
 */
export function evaluateFormula(expression: string, context: Record<string, unknown> = {}): FormulaValue {
  const toks = tokenize(expression);
  let pos = 0;
  let depth = 0;

  const peek = (): Tok | undefined => toks[pos];
  const next = (): Tok => {
    const t = toks[pos];
    if (!t) throw new FormulaError("unexpected end of expression");
    pos++;
    return t;
  };
  const guard = (): void => {
    if (++depth > MAX_DEPTH) throw new FormulaError("expression too deeply nested");
  };

  function resolveField(name: string): FormulaValue {
    const v = context[name];
    if (v === undefined || v === null) return null;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
    return String(v);
  }

  function parseOr(): FormulaValue {
    guard();
    let left = parseAnd();
    while (peek()?.type === "op" && peek()!.value === "OR") {
      next();
      const right = parseAnd();
      left = truthy(left) || truthy(right);
    }
    depth--;
    return left;
  }

  function parseAnd(): FormulaValue {
    let left = parseComparison();
    while (peek()?.type === "op" && peek()!.value === "AND") {
      next();
      const right = parseComparison();
      left = truthy(left) && truthy(right);
    }
    return left;
  }

  function parseComparison(): FormulaValue {
    const left = parseAdditive();
    const t = peek();
    if (t?.type === "op" && ["==", "!=", ">", "<", ">=", "<="].includes(t.value)) {
      next();
      const right = parseAdditive();
      switch (t.value) {
        case "==": return left === right || String(left) === String(right);
        case "!=": return left !== right && String(left) !== String(right);
        case ">": return toNum(left) > toNum(right);
        case "<": return toNum(left) < toNum(right);
        case ">=": return toNum(left) >= toNum(right);
        case "<=": return toNum(left) <= toNum(right);
      }
    }
    return left;
  }

  function parseAdditive(): FormulaValue {
    let left = parseMultiplicative();
    while (peek()?.type === "op" && (peek()!.value === "+" || peek()!.value === "-")) {
      const op = next().value;
      const right = parseMultiplicative();
      if (op === "+") {
        if (typeof left === "string" || typeof right === "string") left = `${left ?? ""}${right ?? ""}`;
        else left = toNum(left) + toNum(right);
      } else {
        left = toNum(left) - toNum(right);
      }
    }
    return left;
  }

  function parseMultiplicative(): FormulaValue {
    let left = parseUnary();
    while (peek()?.type === "op" && ["*", "/", "%"].includes(peek()!.value)) {
      const op = next().value;
      const right = toNum(parseUnary());
      const l = toNum(left);
      if ((op === "/" || op === "%") && right === 0) throw new FormulaError("division by zero");
      left = op === "*" ? l * right : op === "/" ? l / right : l % right;
    }
    return left;
  }

  function parseUnary(): FormulaValue {
    const t = peek();
    if (t?.type === "op" && t.value === "-") { next(); return -toNum(parseUnary()); }
    if (t?.type === "op" && t.value === "NOT") { next(); return !truthy(parseUnary()); }
    return parsePrimary();
  }

  function parsePrimary(): FormulaValue {
    const t = next();
    if (t.type === "num") return Number(t.value);
    if (t.type === "str") return t.value;
    if (t.type === "paren" && t.value === "(") {
      const v = parseOr();
      const close = next();
      if (close.value !== ")") throw new FormulaError("expected )");
      return v;
    }
    if (t.type === "ident") {
      if (t.value === "TRUE") return true;
      if (t.value === "FALSE") return false;
      if (t.value === "NULL") return null;
      if (FUNCS.has(t.value)) {
        if (peek()?.value !== "(") throw new FormulaError(`expected ( after ${t.value}`);
        next();
        const args: FormulaValue[] = [];
        if (peek()?.value !== ")") {
          args.push(parseOr());
          while (peek()?.type === "comma") { next(); args.push(parseOr()); }
        }
        const close = next();
        if (close.value !== ")") throw new FormulaError("expected )");
        return applyFunc(t.value, args);
      }
      return resolveField(t.value);
    }
    throw new FormulaError(`unexpected token: ${t.value}`);
  }

  const result = parseOr();
  if (pos !== toks.length) throw new FormulaError(`unexpected trailing token: ${peek()?.value}`);
  return result;
}

/** Runtime (data-dependent) errors that do not indicate a malformed expression. */
const DATA_ERRORS = ["division by zero", "not a number", "SQRT of negative"];

/**
 * Static validation: surfaces structural/syntax errors only. Data-dependent
 * runtime errors (e.g. division by zero when a field is blank) are NOT treated
 * as invalid, since they depend on the record being evaluated rather than the
 * expression's shape.
 */
export function validateFormula(expression: string): { valid: boolean; error?: string } {
  try {
    evaluateFormula(expression, {});
    return { valid: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (DATA_ERRORS.some((d) => msg.includes(d))) return { valid: true };
    return { valid: false, error: msg };
  }
}
