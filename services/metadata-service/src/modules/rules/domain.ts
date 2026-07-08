/**
 * Metadata validation rule engine.
 *
 * Evaluates safe expressions against record data to enforce tenant-defined
 * validation rules at write time. Expressions use a restricted grammar:
 *
 *   - Field references: field_api_name (resolved from record data)
 *   - Operators: ==, !=, >, <, >=, <=, AND, OR, NOT
 *   - Literals: numbers, strings (quoted), true, false, null
 *   - Functions: LEN(field), ISBLANK(field), TODAY()
 *
 * NO eval(), no arbitrary JS — safe by construction.
 */

export class ValidationError extends Error {
  constructor(
    public readonly ruleName: string,
    public readonly errorMessage: string,
  ) {
    super(`[VALIDATION_RULE] ${ruleName}: ${errorMessage}`);
    this.name = "ValidationError";
  }
}

export interface FieldDef {
  apiName: string;
  fieldType: string;
  isRequired: boolean;
  picklistValues?: string[];
}

export interface ValidationRule {
  name: string;
  expression: string;
  errorMessage: string;
  isActive: boolean;
}

// ── Expression Tokenizer ──────────────────────────────────────────────────────

type TokenType = "field" | "op" | "literal" | "paren" | "func" | "comma";
interface Token { type: TokenType; value: string }

const OPERATORS = new Set(["==", "!=", ">", "<", ">=", "<=", "AND", "OR", "NOT"]);
const FUNCTIONS = new Set(["LEN", "ISBLANK", "TODAY", "ISNUMBER"]);

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    if (/\s/.test(expr[i]!)) { i++; continue; }
    if (expr[i] === "(" || expr[i] === ")") { tokens.push({ type: "paren", value: expr[i]! }); i++; continue; }
    if (expr[i] === ",") { tokens.push({ type: "comma", value: "," }); i++; continue; }
    // String literal
    if (expr[i] === '"' || expr[i] === "'") {
      const q = expr[i]!;
      let s = ""; i++;
      while (i < expr.length && expr[i] !== q) { s += expr[i]; i++; }
      i++; // skip closing quote
      tokens.push({ type: "literal", value: s });
      continue;
    }
    // Number literal
    if (/[\d.]/.test(expr[i]!)) {
      let n = "";
      while (i < expr.length && /[\d.]/.test(expr[i]!)) { n += expr[i]; i++; }
      tokens.push({ type: "literal", value: n });
      continue;
    }
    // Operators (multi-char)
    if (expr[i] === "!" && expr[i + 1] === "=") { tokens.push({ type: "op", value: "!=" }); i += 2; continue; }
    if (expr[i] === "=" && expr[i + 1] === "=") { tokens.push({ type: "op", value: "==" }); i += 2; continue; }
    if (expr[i] === ">" && expr[i + 1] === "=") { tokens.push({ type: "op", value: ">=" }); i += 2; continue; }
    if (expr[i] === "<" && expr[i + 1] === "=") { tokens.push({ type: "op", value: "<=" }); i += 2; continue; }
    if (expr[i] === ">") { tokens.push({ type: "op", value: ">" }); i++; continue; }
    if (expr[i] === "<") { tokens.push({ type: "op", value: "<" }); i++; continue; }
    // Identifiers (field names, keywords, functions)
    if (/[a-zA-Z_]/.test(expr[i]!)) {
      let id = "";
      while (i < expr.length && /[a-zA-Z_0-9]/.test(expr[i]!)) { id += expr[i]; i++; }
      const upper = id.toUpperCase();
      if (OPERATORS.has(upper)) { tokens.push({ type: "op", value: upper }); }
      else if (FUNCTIONS.has(upper)) { tokens.push({ type: "func", value: upper }); }
      else if (upper === "TRUE" || upper === "FALSE" || upper === "NULL") { tokens.push({ type: "literal", value: upper.toLowerCase() }); }
      else { tokens.push({ type: "field", value: id }); }
      continue;
    }
    // Skip unknown chars
    i++;
  }
  return tokens;
}

// ── Expression Evaluator (recursive descent) ──────────────────────────────────

type Value = string | number | boolean | null;

function resolveField(fieldName: string, data: Record<string, unknown>): Value {
  const v = data[fieldName];
  if (v === undefined || v === null) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  return String(v);
}

function evaluateFunc(name: string, args: Value[]): Value {
  switch (name) {
    case "LEN": return args[0] != null ? String(args[0]).length : 0;
    case "ISBLANK": return args[0] === null || args[0] === "" || args[0] === undefined;
    case "ISNUMBER": return typeof args[0] === "number" || (typeof args[0] === "string" && !isNaN(Number(args[0])));
    case "TODAY": return new Date().toISOString().slice(0, 10);
    default: return null;
  }
}

function compare(left: Value, op: string, right: Value): boolean {
  if (op === "==") return left === right || String(left) === String(right);
  if (op === "!=") return left !== right && String(left) !== String(right);
  const l = Number(left); const r = Number(right);
  if (isNaN(l) || isNaN(r)) return false;
  if (op === ">") return l > r;
  if (op === "<") return l < r;
  if (op === ">=") return l >= r;
  if (op === "<=") return l <= r;
  return false;
}

/**
 * Evaluate a validation expression against record data. Returns true if the
 * rule PASSES (record is valid); false if it FAILS (record violates the rule).
 */
export function evaluateExpression(expression: string, data: Record<string, unknown>): boolean {
  const tokens = tokenize(expression);
  let pos = 0;

  function peek(): Token | undefined { return tokens[pos]; }
  function consume(): Token { return tokens[pos++]!; }

  function parseOr(): boolean {
    let result = parseAnd();
    while (peek()?.value === "OR") { consume(); result = parseAnd() || result; }
    return result;
  }

  function parseAnd(): boolean {
    let result = parseComparison();
    while (peek()?.value === "AND") { consume(); result = parseComparison() && result; }
    return result;
  }

  function parseComparison(): boolean {
    if (peek()?.value === "NOT") { consume(); return !parseComparison(); }
    const left = parseValue();
    const op = peek();
    if (op?.type === "op" && !OPERATORS.has(op.value) === false && op.value !== "AND" && op.value !== "OR" && op.value !== "NOT") {
      consume();
      const right = parseValue();
      return compare(left, op.value, right);
    }
    // Truthy check (bare field or function)
    return left !== null && left !== false && left !== 0 && left !== "";
  }

  function parseValue(): Value {
    const t = peek();
    if (!t) return null;
    if (t.type === "paren" && t.value === "(") {
      consume();
      const result = parseOr();
      if (peek()?.value === ")") consume();
      return result;
    }
    if (t.type === "func") {
      const funcName = consume().value;
      if (peek()?.value === "(") consume();
      const args: Value[] = [];
      while (peek() && peek()?.value !== ")") {
        args.push(parseValue());
        if (peek()?.value === ",") consume();
      }
      if (peek()?.value === ")") consume();
      return evaluateFunc(funcName, args);
    }
    if (t.type === "field") { consume(); return resolveField(t.value, data); }
    if (t.type === "literal") {
      consume();
      if (t.value === "true") return true;
      if (t.value === "false") return false;
      if (t.value === "null") return null;
      const num = Number(t.value);
      return isNaN(num) ? t.value : num;
    }
    consume();
    return null;
  }

  return parseOr();
}

// ── Field Type Validation ─────────────────────────────────────────────────────

export function validateFieldValue(value: unknown, field: FieldDef): string | null {
  if (value === null || value === undefined || value === "") {
    return field.isRequired ? `${field.label ?? field.apiName} is required` : null;
  }
  switch (field.fieldType) {
    case "text":
      if (typeof value !== "string") return `${field.apiName} must be a string`;
      break;
    case "number":
    case "currency":
      if (typeof value !== "number" && isNaN(Number(value))) return `${field.apiName} must be a number`;
      break;
    case "boolean":
      if (typeof value !== "boolean") return `${field.apiName} must be a boolean`;
      break;
    case "date":
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) return `${field.apiName} must be a valid date`;
      break;
    case "picklist":
      if (field.picklistValues && !field.picklistValues.includes(String(value))) {
        return `${field.apiName} must be one of: ${field.picklistValues.join(", ")}`;
      }
      break;
  }
  return null;
}

/**
 * Validate a record against all field definitions and active validation rules.
 * Returns array of error messages (empty = valid).
 */
export function validateRecord(
  data: Record<string, unknown>,
  fields: FieldDef[],
  rules: ValidationRule[],
): string[] {
  const errors: string[] = [];

  // Field-level validation
  for (const field of fields) {
    const err = validateFieldValue(data[field.apiName], field);
    if (err) errors.push(err);
  }

  // Rule-level validation
  for (const rule of rules) {
    if (!rule.isActive) continue;
    const passes = evaluateExpression(rule.expression, data);
    if (!passes) errors.push(rule.errorMessage);
  }

  return errors;
}
