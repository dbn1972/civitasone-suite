import { NextResponse } from "next/server";
import { safeNextPath } from "@/lib/auth/safeNext";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { isDevLoginEnabled, assertDevLoginConfig } from "@/lib/auth/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TENANT = process.env.DEMO_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";
// Second demo tenant — used by the cross-department / consent-exchange persona.
const TENANT2 = "00000000-0000-0000-0000-000000000002";

const ALL_ROLES = [
  "super_admin", "admin", "tenant_admin", "platform_admin",
  "finance_admin", "hr_admin", "procurement_admin", "audit_admin",
  "legal_admin", "project_admin", "grant_admin", "asset_admin",
  "stock_admin", "crm_admin", "helpdesk_admin", "estab_admin",
  "reader", "viewer", "officer",
];

type DevUser = { sub: string; name: string; email: string; roles: string[]; tenant?: string };

// ─────────────────────────────────────────────────────────────────────────────
// DEV-ONLY demo personas. Kept in sync with scripts/demo/seed-demo.mjs so the
// same persona that exists in identity-service / RBAC / Keycloak can also log
// in through this dev-login form. Every persona shares the single demo password
// (DEV_LOGIN_PASSWORD, validated per-request via assertDevLoginConfig()).
// NEVER enable this route or these accounts in production.
// ─────────────────────────────────────────────────────────────────────────────
const USERS: Record<string, DevUser> = {
  // ── legacy blanket accounts (retained for backwards compatibility) ──
  superadmin: {
    sub: "00000000-0000-0000-0000-000000000099",
    name: "Super Admin", email: "superadmin@demo.gov.in", roles: ALL_ROLES,
  },
  officer: {
    sub: "00000000-0000-0000-0000-000000000098",
    name: "Department Officer", email: "officer@civitasone.dev",
    roles: ["officer", "finance_admin", "hr_admin", "procurement_admin", "crm_admin", "reader", "viewer"],
  },
  auditor: {
    sub: "0de00000-0000-0000-0000-000000000006",
    name: "Internal Auditor", email: "auditor@demo.gov.in",
    roles: ["audit_officer", "audit_admin", "reader", "viewer"],
  },

  // ── named project personas ──
  dnayak: {
    sub: "00000000-0000-0000-0000-000000000001",
    name: "D. Nayak", email: "dnayak@digitalindia.gov.in",
    roles: ["super_admin", "admin", "hr_admin", "hr_officer", "estab_admin", "finance_admin", "reader", "viewer"],
  },

  // ── granular government personas (mirrors scripts/demo/seed-demo.mjs) ──
  commissioner: {
    sub: "0de00000-0000-0000-0000-000000000001",
    name: "Municipal Commissioner", email: "commissioner@demo.gov.in",
    roles: ["tenant_admin", "admin"],
  },
  hrofficer: {
    sub: "0de00000-0000-0000-0000-000000000002",
    name: "HR / Establishment Officer", email: "hrofficer@demo.gov.in",
    roles: ["hr_officer", "hr_admin", "estab_officer"],
  },
  financeofficer: {
    sub: "0de00000-0000-0000-0000-000000000003",
    name: "Finance / Budget Officer", email: "financeofficer@demo.gov.in",
    roles: ["finance_officer", "budget_officer"],
  },
  financeadmin: {
    sub: "0de00000-0000-0000-0000-000000000004",
    name: "Chief Accounts Officer", email: "financeadmin@demo.gov.in",
    roles: ["finance_admin"],
  },
  procurementofficer: {
    sub: "0de00000-0000-0000-0000-000000000005",
    name: "Procurement Officer", email: "procurementofficer@demo.gov.in",
    roles: ["procurement_officer", "procurement_admin"],
  },
  legalofficer: {
    sub: "0de00000-0000-0000-0000-000000000007",
    name: "Law Officer", email: "legalofficer@demo.gov.in",
    roles: ["legal_officer", "legal_admin"],
  },
  inspector: {
    sub: "0de00000-0000-0000-0000-000000000008",
    name: "Field Inspector", email: "inspector@demo.gov.in",
    roles: ["inspector", "inspection_admin"],
  },
  grievanceofficer: {
    sub: "0de00000-0000-0000-0000-000000000009",
    name: "Grievance / Dept Officer", email: "grievanceofficer@demo.gov.in",
    roles: ["grievance_officer", "citizen_officer", "dept_officer"],
  },
  citizen: {
    sub: "0de00000-0000-0000-0000-00000000000a",
    name: "Citizen (Public User)", email: "citizen@demo.gov.in",
    roles: ["citizen"],
  },
  dataprincipal: {
    sub: "0de00000-0000-0000-0000-00000000000b",
    name: "Data Principal (Consent)", email: "dataprincipal@demo.gov.in",
    roles: ["data_principal", "citizen"],
  },
  partnerofficer: {
    sub: "0de00000-0000-0000-0000-00000000000c",
    name: "Partner Dept Officer", email: "partnerofficer@demo.gov.in",
    roles: ["tenant_admin", "dept_officer", "citizen_officer"], tenant: TENANT2,
  },
};

function b64url(o: object): string {
  return Buffer.from(JSON.stringify(o)).toString("base64url");
}

function mint(u: DevUser, tenantId: string, secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url({
    sub: u.sub, iss: "civitasone-dev",
    tid: tenantId, tenantId, sid: "dev-session",
    email: u.email, name: u.name, roles: u.roles,
    iat: now, exp: now + 60 * 60 * 12,
  });
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function publicBase(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

// GAP-AUTH-DEV-04: validate the submitted form at the boundary. Non-string
// (e.g. a file part, or a repeated field coerced oddly) fields are rejected
// before any lookup/compare runs.
const DevLoginSchema = z.object({
  username: z.string().max(128),
  password: z.string().max(512),
  tenant: z.string().max(128).optional().default(""),
  next: z.string().max(2048).optional().default(""),
});

// GAP-AUTH-DEV-02: per-IP + per-username in-memory failure throttle with
// lockout. This is a dev-only bypass route with a tiny set of shared accounts;
// an in-memory counter per server process is sufficient to blunt brute force
// without pulling in Redis for a route that must never run in production.
const MAX_FAILURES = 5; // 6th attempt within the window is locked out
const WINDOW_MS = 60_000;
const FAIL_DELAY_MS = 300; // small constant delay on every failure
type Attempt = { count: number; first: number };
const attempts = new Map<string, Attempt>();

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function throttleKey(req: Request, username: string): string {
  return `${clientIp(req)}:${username}`;
}

/** Returns true if this key is currently locked out. Prunes expired windows. */
function isLockedOut(key: string): boolean {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return a.count >= MAX_FAILURES;
}

function recordFailure(key: string): void {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: now });
  } else {
    a.count += 1;
  }
}

function clearFailures(key: string): void {
  attempts.delete(key);
}

// GAP-AUTH-DEV-02: reject cross-site form POSTs. The session cookie is
// sameSite=lax, so a cross-site <form> POST would otherwise be accepted
// (login CSRF). Require the Origin (or, as a fallback, Referer) host to match
// the request's own public host.
function originAllowed(req: Request): boolean {
  const expectedHost = new URL(publicBase(req)).host;
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === expectedHost;
    } catch {
      return false;
    }
  }
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host === expectedHost;
    } catch {
      return false;
    }
  }
  // No Origin and no Referer: a same-origin form POST from a modern browser
  // always sends at least one of them; absence is treated as untrusted.
  return false;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isDevLoginEnabled()) {
    return Response.json({ error: "Not available" }, { status: 404 }) as NextResponse;
  }

  // GAP-AUTH-DEV-01: fail closed on a misconfigured bypass (production,
  // missing signing secret, or empty demo password) rather than minting a
  // token that would match every persona.
  let secret: string;
  try {
    ({ secret } = assertDevLoginConfig());
  } catch {
    return Response.json({ error: "Not available" }, { status: 404 }) as NextResponse;
  }

  const base = publicBase(req);

  // GAP-AUTH-DEV-02: CSRF/origin gate.
  if (!originAllowed(req)) {
    return Response.json({ error: "Forbidden" }, { status: 403 }) as NextResponse;
  }

  // GAP-AUTH-DEV-04: validate the form at the boundary.
  const form = await req.formData();
  const parsed = DevLoginSchema.safeParse({
    username: form.get("username"),
    password: form.get("password"),
    tenant: form.get("tenant") ?? undefined,
    next: form.get("next") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.redirect(new URL("/auth/dev?error=1", base), { status: 303 });
  }

  const username = parsed.data.username.trim().toLowerCase();
  const password = parsed.data.password;
  const tenantInput = parsed.data.tenant.trim();
  const u = USERS[username];

  // GAP-AUTH-DEV-02: lockout check before doing any credential comparison.
  const key = throttleKey(req, username);
  if (isLockedOut(key)) {
    const res = Response.json(
      { error: "Too many attempts. Try again later." },
      { status: 429 },
    ) as NextResponse;
    res.headers.set("Retry-After", "60");
    return res;
  }

  // Per-persona default tenant (e.g. the partner-dept persona lives in tenant 2),
  // overridable by an explicit Office ID in the form.
  const tenantId = UUID_RE.test(tenantInput) ? tenantInput : (u?.tenant ?? TENANT);

  // GAP-AUTH-DEV-01: single shared demo password, validated against the
  // non-empty secret from assertDevLoginConfig(). An empty password can no
  // longer match (config assertion already rejected an empty configured
  // password above).
  if (!u || password.length === 0 || password !== assertDevLoginConfig().password) {
    recordFailure(key);
    await new Promise((r) => setTimeout(r, FAIL_DELAY_MS));
    return NextResponse.redirect(new URL("/auth/dev?error=1", base), { status: 303 });
  }

  clearFailures(key);
  const token = mint(u, tenantId, secret);
  const nextPath = parsed.data.next.trim();
  const safePath = safeNextPath(nextPath) ?? "/dashboard";
  const res = NextResponse.redirect(new URL(safePath, base), { status: 303 });
  res.cookies.set("civitasone_at", token, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 12,
  });
  return res;
}
