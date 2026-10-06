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
//  - Every minted session is pinned to the single DEMO_TENANT_ID demo office so
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

// NOTE: fall back to the dev secret so local/test runs mint a decodable token;
// production sets JWT_SECRET. Mirrors api/auth/dev-login/route.ts.
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow
const DEMO_TENANT = process.env.DEMO_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";

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

function mint(r: SandboxRole): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url({
    sub: r.sub,
    iss: "civitasone-sandbox",
    tid: DEMO_TENANT,
    tenantId: DEMO_TENANT,
    sid: "sandbox-session",
    email: r.email,
    name: r.name,
    roles: r.roles,
    sandbox: true,
    iat: now,
    exp: now + 60 * 60 * 2,
  });
  const sig = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

function publicBase(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export async function GET(req: Request): Promise<NextResponse> {
  if (!isSandboxEnabled()) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  const base = publicBase(req);
  const roleParam = new URL(req.url).searchParams.get("role");
  const parsed = roleSchema.safeParse(roleParam);
  if (!parsed.success) {
    return NextResponse.json({ error: "Unknown sandbox role" }, { status: 400 });
  }

  const persona = SANDBOX_ROLES[parsed.data]!;
  const token = mint(persona);
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
