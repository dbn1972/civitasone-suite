import { NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { isDevLoginEnabled } from "@/lib/auth/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SECRET = process.env.JWT_SECRET ?? "civitasone-dev-secret";
const TENANT = process.env.DEMO_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";
// Second demo tenant — used by the cross-department / consent-exchange persona.
const TENANT2 = "00000000-0000-0000-0000-000000000002";
// Dev-only demo password. Real value lives in an untracked apps/web/.env (DEV_LOGIN_PASSWORD).
const DEV_PASSWORD = process.env.DEV_LOGIN_PASSWORD ?? "";

const ALL_ROLES = [
  "super_admin", "admin", "tenant_admin", "platform_admin",
  "finance_admin", "hr_admin", "procurement_admin", "audit_admin",
  "legal_admin", "project_admin", "grant_admin", "asset_admin",
  "stock_admin", "crm_admin", "helpdesk_admin", "estab_admin",
  "reader", "viewer", "officer",
];

type DevUser = { password: string; sub: string; name: string; email: string; roles: string[]; tenant?: string };

// ─────────────────────────────────────────────────────────────────────────────
// DEV-ONLY demo personas. Kept in sync with scripts/demo/seed-demo.mjs so the
// same persona that exists in identity-service / RBAC / Keycloak can also log
// in through this dev-login form. Every persona shares the single demo password
// (DEV_LOGIN_PASSWORD). NEVER enable this route or these accounts in production.
// ─────────────────────────────────────────────────────────────────────────────
const USERS: Record<string, DevUser> = {
  // ── legacy blanket accounts (retained for backwards compatibility) ──
  superadmin: {
    password: DEV_PASSWORD, sub: "00000000-0000-0000-0000-000000000099",
    name: "Super Admin", email: "superadmin@demo.gov.in", roles: ALL_ROLES,
  },
  officer: {
    password: DEV_PASSWORD, sub: "00000000-0000-0000-0000-000000000098",
    name: "Department Officer", email: "officer@civitasone.dev",
    roles: ["officer", "finance_admin", "hr_admin", "procurement_admin", "crm_admin", "reader", "viewer"],
  },
  auditor: {
    password: DEV_PASSWORD, sub: "0de00000-0000-0000-0000-000000000006",
    name: "Internal Auditor", email: "auditor@demo.gov.in",
    roles: ["audit_officer", "audit_admin", "reader", "viewer"],
  },

  // ── granular government personas (mirrors scripts/demo/seed-demo.mjs) ──
  commissioner: {
    password: DEV_PASSWORD, sub: "0de00000-0000-0000-0000-000000000001",
    name: "Municipal Commissioner", email: "commissioner@demo.gov.in",
    roles: ["tenant_admin", "admin"],
  },
  hrofficer: {
    password: DEV_PASSWORD, sub: "0de00000-0000-0000-0000-000000000002",
    name: "HR / Establishment Officer", email: "hrofficer@demo.gov.in",
    roles: ["hr_officer", "hr_admin", "estab_officer"],
  },
  financeofficer: {
    password: DEV_PASSWORD, sub: "0de00000-0000-0000-0000-000000000003",
    name: "Finance / Budget Officer", email: "financeofficer@demo.gov.in",
    roles: ["finance_officer", "budget_officer"],
  },
  financeadmin: {
    password: DEV_PASSWORD, sub: "0de00000-0000-0000-0000-000000000004",
    name: "Chief Accounts Officer", email: "financeadmin@demo.gov.in",
    roles: ["finance_admin"],
  },
  procurementofficer: {
    password: DEV_PASSWORD, sub: "0de00000-0000-0000-0000-000000000005",
    name: "Procurement Officer", email: "procurementofficer@demo.gov.in",
    roles: ["procurement_officer", "procurement_admin"],
  },
  legalofficer: {
    password: DEV_PASSWORD, sub: "0de00000-0000-0000-0000-000000000007",
    name: "Law Officer", email: "legalofficer@demo.gov.in",
    roles: ["legal_officer", "legal_admin"],
  },
  inspector: {
    password: DEV_PASSWORD, sub: "0de00000-0000-0000-0000-000000000008",
    name: "Field Inspector", email: "inspector@demo.gov.in",
    roles: ["inspector", "inspection_admin"],
  },
  grievanceofficer: {
    password: DEV_PASSWORD, sub: "0de00000-0000-0000-0000-000000000009",
    name: "Grievance / Dept Officer", email: "grievanceofficer@demo.gov.in",
    roles: ["grievance_officer", "citizen_officer", "dept_officer"],
  },
  citizen: {
    password: DEV_PASSWORD, sub: "0de00000-0000-0000-0000-00000000000a",
    name: "Citizen (Public User)", email: "citizen@demo.gov.in",
    roles: ["citizen"],
  },
  dataprincipal: {
    password: DEV_PASSWORD, sub: "0de00000-0000-0000-0000-00000000000b",
    name: "Data Principal (Consent)", email: "dataprincipal@demo.gov.in",
    roles: ["data_principal", "citizen"],
  },
  partnerofficer: {
    password: DEV_PASSWORD, sub: "0de00000-0000-0000-0000-00000000000c",
    name: "Partner Dept Officer", email: "partnerofficer@demo.gov.in",
    roles: ["tenant_admin", "dept_officer", "citizen_officer"], tenant: TENANT2,
  },
};

function b64url(o: object): string {
  return Buffer.from(JSON.stringify(o)).toString("base64url");
}

function mint(u: DevUser, tenantId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url({
    sub: u.sub, iss: "civitasone-dev", aud: "civitasone",
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
  const u = USERS[username];
  // Per-persona default tenant (e.g. the partner-dept persona lives in tenant 2),
  // overridable by an explicit Office ID in the form.
  const tenantId = UUID_RE.test(tenantInput) ? tenantInput : (u?.tenant ?? TENANT);

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
