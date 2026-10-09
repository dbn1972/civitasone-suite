import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { COOKIE } from "@/lib/auth/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// GAP-SANDBOX-HOME-02: passwordless demo sign-in for the public /sandbox page.
//
// SAFETY (recorded decision — see batch1.md HOME-02, Risk: High):
//  - This route is OFF unless ENABLE_SANDBOX === "true" (fail closed), the same
//    opt-in shape as isDevLoginEnabled() for /auth/dev. When disabled it returns
//    404 so the feature is invisible, not just hidden in the UI.
//  - Every minted session is pinned to the single DEMO_TENANT_ID demo office (required, no default; JWT_SECRET also required, else 404) so
//    no real tenant's data is ever reachable; the demo tenant must contain only
//    fictional data and have email/payment side effects disabled (HUMAN REVIEW).
//  - The role query param is validated with zod against a closed allow-list that
//    mirrors the seven cards in (marketing)/sandbox/page.tsx; anything else 400s.
//  - Each persona is granted a deliberately restrictive demo role set.
// ─────────────────────────────────────────────────────────────────────────────

/** True only when the public sandbox demo sign-in is explicitly enabled. */
function isSandboxEnabled(): boolean {
  return process.env.ENABLE_SANDBOX === "true";
}

/** The dev-login default tenant: never a valid demo tenant in production. */
const DEV_DEFAULT_TENANT = "00000000-0000-0000-0000-000000000001";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Fail closed: both a signing secret and an explicit, dedicated demo tenant are
 * required. No fallback secret, no fallback tenant. Read per request.
 */
function sandboxConfig(): { secret: string; tenant: string } | null {
  const secret = process.env.JWT_SECRET ?? "";
  const tenant = (process.env.DEMO_TENANT_ID ?? "").trim();
  if (secret.length < 32 || !UUID_RE.test(tenant)) return null;
  if (process.env.NODE_ENV === "production" && tenant === DEV_DEFAULT_TENANT) return null;
  return { secret, tenant };
}

type SandboxRole = {
  /** Stable demo subject id (kept distinct from the dev-login personas). */
  sub: string;
  name: string;
  email: string;
  /** Restrictive demo role set — never super_admin for a public persona. */
  roles: string[];
};

// Keyed by the `role.id` values rendered on (marketing)/sandbox/page.tsx.
const SANDBOX_ROLES: Record<string, SandboxRole> = {
  "office-head": {
    sub: "5a000000-0000-0000-0000-000000000001",
    name: "Demo Office Head",
    email: "office-head@sandbox.demo",
    roles: ["tenant_admin", "reader", "viewer"],
  },
  "finance-clerk": {
    sub: "5a000000-0000-0000-0000-000000000002",
    name: "Demo Finance Clerk",
    email: "finance-clerk@sandbox.demo",
    roles: ["finance_officer", "reader", "viewer"],
  },
  "hr-officer": {
    sub: "5a000000-0000-0000-0000-000000000003",
    name: "Demo HR Officer",
    email: "hr-officer@sandbox.demo",
    roles: ["hr_officer", "estab_officer", "reader", "viewer"],
  },
  procurement: {
    sub: "5a000000-0000-0000-0000-000000000004",
    name: "Demo Procurement Officer",
    email: "procurement@sandbox.demo",
    roles: ["procurement_officer", "reader", "viewer"],
  },
  "small-business": {
    sub: "5a000000-0000-0000-0000-000000000005",
    name: "Demo Small Business",
    email: "small-business@sandbox.demo",
    roles: ["finance_officer", "reader", "viewer"],
  },
  citizen: {
    sub: "5a000000-0000-0000-0000-000000000006",
    name: "Demo Citizen",
    email: "citizen@sandbox.demo",
    roles: ["citizen"],
  },
  admin: {
    sub: "5a000000-0000-0000-0000-000000000007",
    name: "Demo Admin",
    email: "admin@sandbox.demo",
    roles: ["tenant_admin", "reader", "viewer"],
  },
};

const roleSchema = z.enum(
  Object.keys(SANDBOX_ROLES) as [string, ...string[]],
);

function b64url(o: object): string {
  return Buffer.from(JSON.stringify(o)).toString("base64url");
}

function mint(r: SandboxRole, cfg: { secret: string; tenant: string }): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url({
    sub: r.sub,
    iss: "civitasone-sandbox",
    tid: cfg.tenant,
    tenantId: cfg.tenant,
    sid: "sandbox-session",
    email: r.email,
    name: r.name,
    roles: r.roles,
    sandbox: true,
    iat: now,
    exp: now + 60 * 60 * 2,
  });
  const sig = createHmac("sha256", cfg.secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function publicBase(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

// GAP2-SHELL-SANDBOX-01: establishing a session is a mutation, so it must not
// ride on a GET (CLAUDE.md §4) — a cross-site <img>/link navigation could
// otherwise drop a visitor into a sandbox session (login CSRF). Require a
// same-origin POST and gate on Origin (fallback Referer) exactly like
// /api/auth/dev-login's originAllowed(). The env gate (ENABLE_SANDBOX) and the
// demo-tenant/secret config gate are unchanged.
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
  // A same-origin form POST from a modern browser always sends at least one of
  // Origin/Referer; absence is treated as untrusted (fail closed).
  return false;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isSandboxEnabled()) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  const cfg = sandboxConfig();
  if (!cfg) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  // GAP2-SHELL-SANDBOX-01: CSRF/origin gate before minting any session.
  if (!originAllowed(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const base = publicBase(req);

  // The role is submitted as a form field (POST) rather than a query param.
  // Fall back to the query string so a programmatic same-origin POST can also
  // pass ?role=, but the marketing page posts it in the body.
  let roleParam: string | null = null;
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const r = form.get("role");
    roleParam = typeof r === "string" ? r : null;
  }
  if (roleParam === null) {
    roleParam = new URL(req.url).searchParams.get("role");
  }

  const parsed = roleSchema.safeParse(roleParam);
  if (!parsed.success) {
    return NextResponse.json({ error: "Unknown sandbox role" }, { status: 400 });
  }

  const persona = SANDBOX_ROLES[parsed.data]!;
  const token = mint(persona, cfg);
  const res = NextResponse.redirect(new URL("/dashboard", base), { status: 303 });
  res.cookies.set(COOKIE.ACCESS, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 2,
  });
  return res;
}
