import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { isDevLoginEnabled } from "@/lib/auth/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECRET = process.env.JWT_SECRET ?? "civitasone-dev-secret";
const TENANT = process.env.DEMO_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";

const ALL_ROLES = [
  "super_admin", "admin", "tenant_admin", "platform_admin",
  "finance_admin", "hr_admin", "procurement_admin", "audit_admin",
  "legal_admin", "project_admin", "grant_admin", "asset_admin",
  "stock_admin", "crm_admin", "helpdesk_admin", "estab_admin",
  "reader", "viewer", "officer",
];

type DevUser = { password: string; sub: string; name: string; email: string; roles: string[] };

const USERS: Record<string, DevUser> = {
  superadmin: {
    password: "Civitas@123", sub: "00000000-0000-0000-0000-000000000099",
    name: "Super Admin", email: "superadmin@civitasone.dev", roles: ALL_ROLES,
  },
  officer: {
    password: "Civitas@123", sub: "00000000-0000-0000-0000-000000000098",
    name: "Department Officer", email: "officer@civitasone.dev",
    roles: ["officer", "finance_admin", "hr_admin", "procurement_admin", "crm_admin", "reader", "viewer"],
  },
  auditor: {
    password: "Civitas@123", sub: "00000000-0000-0000-0000-000000000097",
    name: "Auditor / Legal", email: "auditor@civitasone.dev",
    roles: ["audit_admin", "legal_admin", "reader", "viewer"],
  },
};

function b64url(o: object): string {
  return Buffer.from(JSON.stringify(o)).toString("base64url");
}

function mint(u: DevUser, tenantId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url({
    sub: u.sub, iss: "civitasone-dev",
    tid: tenantId, tenantId, sid: "dev-session",
    email: u.email, name: u.name, roles: u.roles,
    iat: now, exp: now + 60 * 60 * 12,
  });
  const sig = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function publicBase(req: Request): string {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!isDevLoginEnabled()) {
    return Response.json({ error: "Not available" }, { status: 404 }) as NextResponse;
  }

  const base = publicBase(req);
  const form = await req.formData();
  const username = String(form.get("username") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  // Optional: let a usability-test participant sign into a specific fresh office.
  const tenantInput = String(form.get("tenant") ?? "").trim();
  const tenantId = UUID_RE.test(tenantInput) ? tenantInput : TENANT;
  const u = USERS[username];

  if (!u || u.password !== password) {
    return NextResponse.redirect(new URL("/auth/dev?error=1", base), { status: 303 });
  }

  const token = mint(u, tenantId);
  const res = NextResponse.redirect(new URL("/dashboard", base), { status: 303 });
  res.cookies.set("civitasone_at", token, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 12,
  });
  return res;
}
