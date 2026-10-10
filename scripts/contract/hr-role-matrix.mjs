#!/usr/bin/env node
/**
 * hr-role-matrix.mjs — static analyzer for GAP-HR-SF-09a.
 *
 * Compares, for every backend route under services/hrms-service/src/modules/**
 * and services/payroll-service/src/modules/** that a page under
 * apps/web/src/app/(app)/hr/** (including /hr/payroll/** and
 * /hr/recruitment/**, which share hr/layout.tsx) is responsible for, the
 * route's own `requireRole(ctx, EXPR)` role list against whatever the web
 * side admits for that area -- either a page's own tighter gate (a
 * `<PermissionDenied requiredRoles={X_ROLES}>` early-return) when one exists,
 * or hr/layout.tsx's shared HR_ROLES (apps/web/src/lib/auth/workRoles.ts)
 * otherwise, since that is the outer boundary for literally every route
 * reachable through /hr, /hr/payroll or /hr/recruitment.
 *
 * Both sides are read live from source on every run (no hand-copied role
 * literals) via the same const-extraction technique used throughout this
 * repo's own route files: find `const X_ROLES = [...]`, resolve string
 * literals and `...SPREAD` references (including one hop across a relative
 * import), recursively.
 *
 * Deliberate scope decisions (see tests/contract/hr-role-matrix.contract.test.ts
 * and its allowlist for the reasoning behind each):
 *
 *  - hr/layout.tsx's HR_ROLES is deliberately the UNION of every role any
 *    /hr, /hr/payroll or /hr/recruitment sub-area needs -- that is the
 *    whole reason one shared layout can gate all of them with a single
 *    list (see that file's own doc comment). It is therefore broader than
 *    almost every individual route's own narrower requirement by
 *    construction, not by accident. Flagging *(role admitted by the web
 *    layout, rejected by this specific backend route)* against the bare
 *    layout default would produce a "drift" on nearly every one of the
 *    ~550 layout-default routes and bury real signal under by-design
 *    noise, so that direction is only evaluated against a page's OWN
 *    dedicated gate (a `PAGE_GATES` match below) -- there, the page's
 *    author made one explicit, specific claim about one specific route,
 *    and it is compared exactly, both directions.
 *  - The reverse direction -- a backend route admitting a role that isn't
 *    even in hr/layout.tsx's HR_ROLES at all -- is NEVER suppressed. Every
 *    such role is unreachable via /hr, /hr/payroll or /hr/recruitment for
 *    ANY user holding only that role, regardless of which specific page
 *    the route backs, because the layout gate runs first for all of them.
 *  - Public/self-service routes that carry no role check by design
 *    (careers/* public candidate portal, self-service/me/*, id-cards/me,
 *    visiting-card public/me) are excluded from the matrix entirely rather
 *    than reported as "no role check" noise.
 *
 * Usage: node scripts/contract/hr-role-matrix.mjs
 * Writes scripts/contract/hr-role-matrix.json.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

// ---------------------------------------------------------------------------
// Generic source-text helpers (comment-stripping, const/import extraction).
// Mirrors this repo's own handler-body `requireRole(ctx, EXPR)` convention;
// see any services/hrms-service/src/modules/**/routes.ts for the pattern.
// ---------------------------------------------------------------------------

function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  let inStr = null;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (inStr) {
      out += c;
      if (c === "\\") {
        out += c2 ?? "";
        i += 2;
        continue;
      }
      if (c === inStr) inStr = null;
      i++;
      continue;
    }
    if (c === "/" && c2 === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      out += c;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const fileSrcCache = new Map();
function readStripped(filePath) {
  if (fileSrcCache.has(filePath)) return fileSrcCache.get(filePath);
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    raw = "";
  }
  const stripped = stripComments(raw);
  fileSrcCache.set(filePath, stripped);
  return stripped;
}

const fileImportsCache = new Map();
function getFileImports(filePath) {
  if (fileImportsCache.has(filePath)) return fileImportsCache.get(filePath);
  const map = new Map();
  fileImportsCache.set(filePath, map);
  const src = readStripped(filePath);
  const importRe = /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
  let im;
  while ((im = importRe.exec(src))) {
    const names = im[1].split(",").map((s) => s.trim()).filter(Boolean);
    const spec = im[2];
    if (!spec.startsWith(".")) continue;
    const resolved = path.resolve(path.dirname(filePath), spec);
    // `import ... from "./x.js"` (the repo's ESM convention) names the COMPILED file; the source is x.ts.
    const asTs = resolved.replace(/\.js$/, ".ts");
    const candidates = [resolved + ".ts", resolved + ".tsx", asTs, resolved, resolved + ".js", path.join(resolved, "index.ts")];
    const found = candidates.find((c) => {
      try {
        return fs.statSync(c).isFile();
      } catch {
        return false;
      }
    });
    for (const nameSpec of names) {
      const parts = nameSpec.split(/\s+as\s+/).map((s) => s.trim());
      const localName = parts[1] || parts[0];
      map.set(localName, { file: found || resolved, exportedAs: parts[0] });
    }
  }
  return map;
}

const fileConstsCache = new Map();
function getFileConsts(filePath) {
  if (fileConstsCache.has(filePath)) return fileConstsCache.get(filePath);
  const map = new Map();
  fileConstsCache.set(filePath, map);
  const src = readStripped(filePath);
  const constRe = /\b(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*(?::[^=]+)?=\s*\[/g;
  let m;
  while ((m = constRe.exec(src))) {
    const name = m[1];
    let idx = m.index + m[0].length;
    let depth = 1;
    const start = idx;
    while (idx < src.length && depth > 0) {
      if (src[idx] === "[") depth++;
      else if (src[idx] === "]") depth--;
      idx++;
    }
    map.set(name, src.slice(start, idx - 1));
  }
  return map;
}

function parseArrayElements(inner) {
  const parts = [];
  let depth = 0;
  let cur = "";
  let inStr = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (inStr) {
      cur += c;
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inStr = c;
      cur += c;
      continue;
    }
    if (c === "[" || c === "(") {
      depth++;
      cur += c;
      continue;
    }
    if (c === "]" || c === ")") {
      depth--;
      cur += c;
      continue;
    }
    if (c === "," && depth === 0) {
      if (cur.trim()) parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function resolveConstValue(filePath, name, visited = new Set()) {
  const key = filePath + "::" + name;
  if (visited.has(key)) return { roles: null, error: "cycle" };
  visited.add(key);
  const consts = getFileConsts(filePath);
  if (!consts.has(name)) {
    const imports = getFileImports(filePath);
    if (imports.has(name)) {
      const src = imports.get(name);
      return resolveConstValue(src.file, src.exportedAs, visited);
    }
    return { roles: null, error: `identifier ${name} not found in ${filePath}` };
  }
  const parts = parseArrayElements(consts.get(name));
  const roles = new Set();
  const errors = [];
  for (const part of parts) {
    const strMatch = part.match(/^["'`](.*)["'`]$/);
    if (strMatch) {
      roles.add(strMatch[1]);
      continue;
    }
    const spreadMatch = part.match(/^\.\.\.([A-Za-z0-9_]+)$/);
    if (spreadMatch) {
      const r = resolveConstValue(filePath, spreadMatch[1], visited);
      if (r.roles) r.roles.forEach((x) => roles.add(x));
      else errors.push(`unresolved spread ...${spreadMatch[1]}: ${r.error}`);
      continue;
    }
    errors.push(`unparsed array element: ${part}`);
  }
  return { roles: Array.from(roles).sort(), error: errors.length ? errors.join("; ") : null };
}

function resolveExpr(filePath, expr) {
  expr = expr.trim();
  if (expr.startsWith("[")) {
    const parts = parseArrayElements(expr.slice(1, expr.lastIndexOf("]")));
    const roles = new Set();
    const errors = [];
    for (const part of parts) {
      const strMatch = part.match(/^["'`](.*)["'`]$/);
      if (strMatch) {
        roles.add(strMatch[1]);
        continue;
      }
      const spreadMatch = part.match(/^\.\.\.([A-Za-z0-9_]+)$/);
      if (spreadMatch) {
        const r = resolveConstValue(filePath, spreadMatch[1]);
        if (r.roles) r.roles.forEach((x) => roles.add(x));
        else errors.push(`unresolved spread ...${spreadMatch[1]}: ${r.error}`);
        continue;
      }
      errors.push(`unparsed inline array element: ${part}`);
    }
    return { roles: Array.from(roles).sort(), error: errors.length ? errors.join("; ") : null };
  }
  if (/^[A-Za-z0-9_]+$/.test(expr)) return resolveConstValue(filePath, expr);
  return { roles: null, error: `unparsed expr: ${expr}` };
}

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "__tests__") continue;
      walk(full, out);
    } else if (entry.isFile() && /\.ts$/.test(entry.name) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

function extractRoutes(filePath) {
  const src = readStripped(filePath);
  const lines = src.split("\n");
  const results = [];
  let currentRoute = null;
  // Requires the captured string to start with "/" so an unrelated same-named
  // method call (e.g. a Map's `.get("10_10")`) can't be mistaken for a
  // Fastify route registration -- every real route path in this codebase
  // starts with "/".
  const routeRe = /\b\w+\.(get|post|put|patch|delete|head|options)\s*\(\s*["'`](\/[^"'`]*)["'`]/i;
  const requireRoleRe = /requireRole\(\s*ctx\s*,\s*(.+?)\)\s*;/;
  const requirePermRe = /requirePermissionKey\(\s*ctx\s*,\s*["'`]([^"'`]+)["'`]\s*\)/;
  // Guards the static `requireRole(ctx, EXPR)` matcher above cannot read. These do NOT
  // change a route's status (a route stays NO_ROLE_CHECK until it carries a statically
  // resolvable role list); they only annotate it with `guardedVia`, so a human can tell
  // "genuinely unguarded" from "guarded by a named helper / inline check".
  const indirectGuardRe = /\b(require(?:Viewer|Decider|InternalServiceCall)|ownEmployeeTarget|requireOwnEmployeeId)\s*\(\s*ctx\b|\bctx\.roles\.includes\(|\bhasAnyRole\(\s*ctx\b/;
  // In-file helper (const X = ... / function X) whose body holds a requireRole/indirect guard:
  // `app.patch(path, decide("approved"))`, `(req, reply) => post(req, reply, ...)`.
  function helperGuard(name) {
    const defRe = new RegExp(`^(\\s*)(?:export\\s+)?(?:async\\s+)?(?:const|function)\\s+${name}\\b`);
    for (let i = 0; i < lines.length; i++) {
      const dm = defRe.exec(lines[i]);
      if (!dm) continue;
      const indent = dm[1].length;
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (/^\s*requireRole\(\s*ctx\b/.test(l) || indirectGuardRe.test(l)) return `${name}() @ line ${j + 1}`;
        // End of the helper: its closing brace at the definition's own indentation.
        if (/^\s*\}[);,]*\s*$/.test(l) && l.length - l.trimStart().length <= indent) break;
      }
    }
    return null;
  }
  const attachGuard = (route, endLn) => {
    if (route.roleChecks.length || route.permChecks.length) return;
    const head = lines[route.line - 1];
    for (let k = route.line - 1; k < endLn; k++) {
      const l = lines[k];
      const im = indirectGuardRe.exec(l);
      if (im) { route.guardedVia = `${(im[1] ?? (l.includes("ctx.roles.includes") ? "ctx.roles.includes" : "hasAnyRole"))} @ line ${k + 1}`; return; }
    }
    // `(?<![.\w])` = a bare helper call, never a method call like `app.post(` / `reply.code(`.
    for (const cm of head.matchAll(/(?<![.\w])([A-Za-z_]\w*)\s*\(/g)) {
      if (/^(async|function|resolveContext)$/.test(cm[1])) continue;
      const g = helperGuard(cm[1]);
      if (g) { route.guardedVia = g; return; }
    }
  };
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln];
    const rm = routeRe.exec(line);
    if (rm) {
      if (currentRoute) attachGuard(currentRoute, ln);
      currentRoute = { method: rm[1].toUpperCase(), routePath: rm[2], line: ln + 1, roleChecks: [], permChecks: [] };
      results.push(currentRoute);
      continue;
    }
    const reqm = requireRoleRe.exec(line);
    if (reqm && currentRoute) {
      currentRoute.roleChecks.push({ expr: reqm[1], line: ln + 1 });
      continue;
    }
    const permm = requirePermRe.exec(line);
    if (permm && currentRoute) currentRoute.permChecks.push({ key: permm[1], line: ln + 1 });
  }
  if (currentRoute) attachGuard(currentRoute, lines.length);
  return results;
}

function extractServiceRoutes(serviceRoot, serviceName) {
  const files = walk(path.resolve(ROOT, serviceRoot), []).filter((f) => /route/i.test(path.basename(f)));
  const out = [];
  for (const file of files) {
    for (const r of extractRoutes(file)) {
      let resolved = [];
      const errs = [];
      if (r.roleChecks.length === 0 && r.permChecks.length === 0) {
        resolved = null;
      } else {
        for (const rc of r.roleChecks) {
          const res = resolveExpr(file, rc.expr);
          if (res.roles) resolved.push(...res.roles);
          if (res.error) errs.push(`(${rc.expr}) ${res.error}`);
        }
        resolved = Array.from(new Set(resolved)).sort();
      }
      out.push({
        service: serviceName,
        file: path.relative(ROOT, file),
        method: r.method,
        routePath: r.routePath,
        line: r.line,
        roleExprs: r.roleChecks.map((x) => x.expr),
        permKeys: r.permChecks.map((x) => x.key),
        ...(r.guardedVia ? { guardedVia: r.guardedVia } : {}),
        roles: resolved,
        errors: errs.length ? errs : null,
        dynamic: errs.length > 0,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Web-side comparators.
// ---------------------------------------------------------------------------

const WEB_ROOT = "apps/web/src/app/(app)/hr";
const LAYOUT_FILE = path.resolve(ROOT, WEB_ROOT, "layout.tsx");
const WORKROLES_FILE = path.resolve(ROOT, "apps/web/src/lib/auth/workRoles.ts");

function layoutHrRoles() {
  // hr/layout.tsx now imports HR_ROLES from workRoles.ts (GAP-HR-SF-09a) --
  // read it from there; fall back to a local const of the same name so this
  // analyzer keeps working against a pre-refactor checkout too.
  const fromShared = resolveConstValue(WORKROLES_FILE, "HR_ROLES");
  if (fromShared.roles) return fromShared.roles;
  return resolveConstValue(LAYOUT_FILE, "HR_ROLES").roles ?? [];
}

// Each entry: which specific /hr, /hr/payroll or /hr/recruitment page has ITS
// OWN tighter (or just different) role gate beyond the shared layout, which
// backend route(s) that page is responsible for, and the exact page file +
// const name to pull the live role list from (never hand-copied).
const PAGE_GATES = [
  { area: "advances", page: "advances/page.tsx", constName: "ADVANCE_ROLES",
    match: (r) => /employee\/loans-routes\.ts$/.test(r.file) && r.routePath.includes("salary-advances") },
  // GAP-HR-SF09A-010 / GAP-HR-APAR-04 / GAP-HR-APAR-NEW-01: apar/routes.ts's
  // create (POST /v1/hrms/apar) and finalise (POST /v1/hrms/apar/:id/
  // finalise) routes are HR-only (backend HR_ROLES), narrower than the rest
  // of the module's ACTOR_ROLES (self-appraisal/reporting/reviewing/accept/
  // representation, which also admit employee/manager) -- carved out into
  // their own comparator so they're checked against apar/new/page.tsx's own
  // APAR_INITIATE_ROLES gate instead of being wrongly compared to the
  // page-wide APAR_ROLES below.
  { area: "apar/new (initiate + finalise)", page: "apar/new/page.tsx", constName: "APAR_INITIATE_ROLES",
    match: (r) => /\/modules\/apar\/routes\.ts$/.test(r.file) && r.method === "POST" &&
      (r.routePath === "/v1/hrms/apar" || r.routePath === "/v1/hrms/apar/:id/finalise") },
  { area: "apar", page: "apar/page.tsx", constName: "APAR_ROLES",
    match: (r) => /\/modules\/apar\/routes\.ts$/.test(r.file) && !(r.method === "POST" &&
      (r.routePath === "/v1/hrms/apar" || r.routePath === "/v1/hrms/apar/:id/finalise")) },
  { area: "attendance/config", page: "attendance/config/page.tsx", constName: "ATTENDANCE_CONFIG_ROLES",
    match: (r) => /\/modules\/attendance\/routes\.ts$/.test(r.file) && r.roleExprs.some((e) => e.includes("LOCK_ROLES")) },
  { area: "departments/new", page: "departments/new/page.tsx", constName: "DEPARTMENT_ADMIN_ROLES",
    // departments/page.tsx (the LIST view) has no hard gate of its own (just
    // a canCreate-style conditional "Add department" button), so the broadly-
    // readable GET /departments correctly falls through to the layout
    // default -- only the mutating routes belong to this create-only page.
    match: (r) => /employee\/masters-routes\.ts$/.test(r.file) && r.routePath.includes("/departments") && r.method !== "GET" },
  { area: "designations/new", page: "designations/new/page.tsx", constName: "DESIGNATION_ADMIN_ROLES",
    match: (r) => /employee\/masters-routes\.ts$/.test(r.file) && r.routePath.includes("/designations") && r.method !== "GET" },
  { area: "disciplinary", page: "disciplinary/page.tsx", constName: "DISCIPLINARY_ROLES",
    match: (r) => /\/modules\/disciplinary\/routes\.ts$/.test(r.file) },
  { area: "employees admin (new/edit/import)", page: "employees/new/page.tsx", constName: "EMPLOYEE_ADMIN_ROLES",
    match: (r) => /\/modules\/employee\/routes\.ts$/.test(r.file) && r.method !== "GET" },
  { area: "icc", page: "icc/page.tsx", constName: "ICC_ROLES",
    match: (r) => /disciplinary\/icc-routes\.ts$/.test(r.file) },
  { area: "id-cards", page: "id-cards/page.tsx", constName: "ID_CARDS_ROLES",
    match: (r) => /\/modules\/id-cards\/routes\.ts$/.test(r.file) && r.routePath !== "/v1/hrms/id-cards/me" },
  { area: "jd-templates", page: "jd-templates/new/page.tsx", constName: "JD_TEMPLATE_ADMIN_ROLES",
    match: (r) => /recruitment\/jd-template-routes\.ts$/.test(r.file) },
  { area: "leave-policies", page: "leave-policies/page.tsx", constName: "LEAVE_POLICY_ADMIN_ROLES",
    match: (r) => /leave\/policy-admin-routes\.ts$/.test(r.file) },
  { area: "leave/allocate", page: "leave/allocate/page.tsx", constName: "LEAVE_ALLOCATE_ADMIN_ROLES",
    match: (r) => /\/modules\/leave\/routes\.ts$/.test(r.file) && r.routePath.includes("leave-allocations") && r.method === "POST" },
  { area: "onboarding", page: "onboarding/page.tsx", constName: "ONBOARDING_ROLES",
    match: (r) => /lifecycle\/onboarding-routes\.ts$/.test(r.file) },
  { area: "payroll/pensioners (view)", page: "payroll/pensioners/page.tsx", constName: "PENSIONER_VIEW_ROLES",
    match: (r) => /payroll-service.*payroll\/routes\.ts$/.test(r.file) && r.routePath.includes("pensioners") && r.method === "GET" },
  { area: "payroll/pensioners (create)", page: "payroll/pensioners/new/page.tsx", constName: "PENSIONER_CREATE_ROLES",
    match: (r) => /payroll-service.*payroll\/routes\.ts$/.test(r.file) && r.routePath.includes("pensioners") && r.method === "POST" },
  { area: "payroll/salary-slips + slips (list)", page: "payroll/salary-slips/page.tsx", constName: "SALARY_ADMIN_ROLES",
    match: (r) => /payroll-service.*(payroll\/routes|payslip-pdf)\.ts$/.test(r.file) && /slips|salary-slips/.test(r.routePath) && r.method === "GET" && !r.routePath.includes(":id") },
  { area: "recruitment/new (create job opening)", page: "recruitment/new/page.tsx", constName: "RECRUITMENT_ADMIN_ROLES",
    match: (r) => /\/modules\/recruitment\/routes\.ts$/.test(r.file) && r.routePath === "/v1/hrms/job-openings" && r.method === "POST" },
  { area: "recruitment/talent-pool", page: "recruitment/talent-pool/page.tsx", constName: "TALENT_POOL_ROLES",
    match: (r) => /\/modules\/recruitment\/routes\.ts$/.test(r.file) && r.routePath === "/v1/hrms/talent-pool" },
  { area: "rti", page: "rti/page.tsx", constName: "RTI_ROLES",
    match: (r) => /\/modules\/rti\/routes\.ts$/.test(r.file) },
  { area: "training/feedback", page: "training/feedback/page.tsx", constName: "TRAINING_ADMIN_ROLES",
    match: (r) => /\/modules\/training\/routes\.ts$/.test(r.file) && r.routePath === "/v1/hrms/training/feedback" },
  { area: "training/new", page: "training/new/page.tsx", constName: "TRAINING_ADMIN_ROLES",
    match: (r) => /\/modules\/training\/routes\.ts$/.test(r.file) && r.routePath === "/v1/hrms/trainings" && r.method === "POST" },
  { area: "training/nominations", page: "training/nominations/page.tsx", constName: "TRAINING_ADMIN_ROLES",
    match: (r) => /\/modules\/training\/routes\.ts$/.test(r.file) && r.routePath === "/v1/hrms/training/nominations" },
  { area: "vigilance", page: "vigilance/page.tsx", constName: "VIGILANCE_ROLES",
    match: (r) => /gap-features\/routes\.ts$/.test(r.file) && r.routePath === "/v1/hrms/vigilance" },
  { area: "work-summary", page: "work-summary/page.tsx", constName: "WORK_SUMMARY_ROLES",
    match: (r) => /gap-features\/routes\.ts$/.test(r.file) && r.routePath === "/v1/hrms/work-summaries" },
];

// Routes that are, by design, reachable without the /hr staff role gate at
// all -- excluded from the matrix rather than reported as false "no role
// check" findings. See the header comment for why.
const OUT_OF_SCOPE_PATTERNS = [
  (r) => r.routePath.startsWith("/v1/careers/"),
  (r) => /recruitment\/routes\.ts$/.test(r.file) && r.routePath.startsWith("/v1/careers"),
  (r) => /self-service\/routes\.ts$/.test(r.file),
  (r) => /id-cards\/routes\.ts$/.test(r.file) && r.routePath === "/v1/hrms/id-cards/me",
  (r) => /visiting-cards\/routes\.ts$/.test(r.file) && /\/me(\/|$)|public\//.test(r.routePath),
];

function resolvePageConst(pageRelPath, constName) {
  const file = path.resolve(ROOT, WEB_ROOT, pageRelPath);
  return resolveConstValue(file, constName);
}

function diff(a, b) {
  const setB = new Set(b);
  return a.filter((x) => !setB.has(x));
}

function main() {
  const hrRoles = layoutHrRoles();
  const hrRolesSet = new Set(hrRoles);

  const hrms = extractServiceRoutes("services/hrms-service/src/modules", "hrms-service");
  const payroll = extractServiceRoutes("services/payroll-service/src/modules", "payroll-service");
  const allRoutes = [...hrms, ...payroll];

  const gateCache = new Map(); // area -> resolved {roles, error}
  function gateFor(area) {
    if (gateCache.has(area)) return gateCache.get(area);
    const g = PAGE_GATES.find((x) => x.area === area);
    const resolved = resolvePageConst(g.page, g.constName);
    gateCache.set(area, resolved);
    return resolved;
  }

  const report = [];
  for (const route of allRoutes) {
    if (OUT_OF_SCOPE_PATTERNS.some((p) => p(route))) {
      report.push({ ...route, comparator: "OUT_OF_SCOPE", status: "OUT_OF_SCOPE" });
      continue;
    }
    if (route.dynamic) {
      report.push({ ...route, comparator: null, status: "DYNAMIC" });
      continue;
    }
    if (route.roles === null) {
      report.push({ ...route, comparator: null, status: "NO_ROLE_CHECK" });
      continue;
    }

    const gate = PAGE_GATES.find((g) => g.match(route));
    let comparatorName;
    let comparatorRoles;
    if (gate) {
      const resolved = gateFor(gate.area);
      comparatorName = `page:${gate.area} (${gate.constName})`;
      comparatorRoles = resolved.roles ?? [];
    } else {
      comparatorName = "layout:HR_ROLES";
      comparatorRoles = hrRoles;
    }

    let extraInBackend = diff(route.roles, comparatorRoles);
    let extraInWeb = diff(comparatorRoles, route.roles);

    if (!gate) {
      // Layout-default carve-out: HR_ROLES is deliberately the UNION of
      // every role any /hr, /hr/payroll or /hr/recruitment sub-area needs
      // (that is the whole reason one shared layout can gate all of them --
      // see hr/layout.tsx's own doc comment), so by construction it is
      // broader than almost every individual route's own narrower
      // requirement. That direction is never a matrix drift for the
      // layout-default comparator; only a page with its OWN dedicated gate
      // (a `gate` match below) makes a specific-enough claim for "web
      // admits a role this route doesn't" to mean anything. The reverse
      // direction (a backend route admitting a role HR_ROLES doesn't even
      // have) is never suppressed, for either comparator kind: that role
      // cannot reach this route through /hr navigation no matter which
      // specific page it belongs to, because the layout runs first.
      extraInWeb = [];
    }

    const status = extraInBackend.length === 0 && extraInWeb.length === 0 ? "MATCH" : "DRIFT";
    report.push({
      ...route,
      comparator: comparatorName,
      comparatorRoles,
      extraInBackend, // role admitted by backend, not by web comparator
      extraInWeb, // role admitted by web comparator, not by this backend route
      status,
    });
  }

  const counts = report.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  const out = {
    generatedAt: new Date().toISOString().slice(0, 10),
    webHrRoles: hrRoles,
    counts,
    routes: report,
  };
  fs.writeFileSync(path.join(__dirname, "hr-role-matrix.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(counts, null, 2));
}

main();
