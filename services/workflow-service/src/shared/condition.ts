/**
 * Safe, dependency-free evaluator for edge condition expressions against an
 * instance context (jsonb). Intentionally tiny: no eval, no function calls.
 *
 * Grammar (single comparison):
 *   <field> <op> <literal>
 * where:
 *   field   = dotted path into context, e.g. "amount" or "request.priority"
 *   op      = == | != | > | >= | < | <= | in
 *   literal = number | 'single-quoted string' | "double-quoted string" |
 *             true | false | null | bare-token | [a, b, c]  (for `in`)
 *
 * A null/empty condition is treated as unconditional (always true).
 */
/**
 * Normalize a context value into a plain object. Some queue/cache transports
 * round-trip the payload as a JSON string; tolerate that so jsonb stays an
 * object and edge conditions evaluate against real fields.
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

export function evaluateCondition(
  expr: string | null | undefined,
  context: Record<string, unknown>,
): boolean {
  if (expr === null || expr === undefined) return true;
  const trimmed = expr.trim();
  if (trimmed === "" || trimmed === "true") return true;
  if (trimmed === "false") return false;

  const m = trimmed.match(/^([A-Za-z_][\w.]*)\s*(==|!=|>=|<=|>|<|\bin\b)\s*(.+)$/);
  if (!m) return false;
  const [, path, op, rawRhs] = m;
  const lhs = resolvePath(context, path!);
  const rhsRaw = rawRhs!.trim();

  if (op === "in") {
    const list = parseList(rhsRaw);
    return list.some((v) => looseEq(lhs, v));
  }

  const rhs = parseLiteral(rhsRaw);
  switch (op) {
    case "==": return looseEq(lhs, rhs);
    case "!=": return !looseEq(lhs, rhs);
    case ">": return numCmp(lhs, rhs) > 0;
    case ">=": return numCmp(lhs, rhs) >= 0;
    case "<": return numCmp(lhs, rhs) < 0;
    case "<=": return numCmp(lhs, rhs) <= 0;
    default: return false;
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

function parseLiteral(raw: string): unknown {
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
    return raw.slice(1, -1);
  }
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  const n = Number(raw);
  if (!Number.isNaN(n) && raw !== "") return n;
  return raw; // bare token compared as string
}

function parseList(raw: string): unknown[] {
  const inner = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
  if (inner.trim() === "") return [];
  return inner.split(",").map((s) => parseLiteral(s.trim()));
}

function looseEq(a: unknown, b: unknown): boolean {
  if (typeof a === "number" || typeof b === "number") {
    return Number(a) === Number(b);
  }
  return String(a) === String(b);
}

function numCmp(a: unknown, b: unknown): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isNaN(na) || Number.isNaN(nb)) return -1; // non-numeric: treat as not-greater
  return na - nb;
}
