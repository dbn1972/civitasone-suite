/**
 * Persona cookie minting for the accessibility gate.
 *
 * The cookie is minted directly rather than driving the /auth/dev form, because
 * that form compares against `process.env.DEV_LOGIN_PASSWORD` which defaults to
 * "" when unset — so on a box without apps/web/.env, no password works and the
 * gate would be unable to authenticate at all. Minting matches exactly what
 * `apps/web/src/app/api/auth/dev-login/route.ts` produces.
 *
 * Roles are kept in sync with that route's USERS map. If a persona's roles drift,
 * the route renders a 403 shell and the gate reports it as a route failure rather
 * than silently auditing an empty page.
 */
import { createHmac } from "node:crypto";
import type { BrowserContext } from "@playwright/test";
import type { Persona } from "./routes.js";

const SECRET = process.env.JWT_SECRET ?? "civitasone-dev-secret";
const TENANT = process.env.DEMO_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";
const TENANT2 = "00000000-0000-0000-0000-000000000002";
const COOKIE = "civitasone_at";

const ALL_ROLES = [
  "super_admin", "admin", "tenant_admin", "platform_admin",
  "finance_admin", "hr_admin", "procurement_admin", "audit_admin",
  "legal_admin", "project_admin", "grant_admin", "asset_admin",
  "stock_admin", "crm_admin", "helpdesk_admin", "estab_admin",
  "reader", "viewer", "officer",
];

type PersonaDef = { sub: string; name: string; email: string; roles: string[]; tenant?: string };

export const PERSONAS: Record<Persona, PersonaDef> = {
  superadmin: {
    sub: "00000000-0000-0000-0000-000000000099",
    name: "Super Admin", email: "superadmin@demo.gov.in", roles: ALL_ROLES,
  },
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
  procurementofficer: {
    sub: "0de00000-0000-0000-0000-000000000005",
    name: "Procurement Officer", email: "procurementofficer@demo.gov.in",
    roles: ["procurement_officer", "procurement_admin"],
  },
  auditor: {
    sub: "0de00000-0000-0000-0000-000000000006",
    name: "Internal Auditor", email: "auditor@demo.gov.in",
    roles: ["audit_officer", "audit_admin", "reader", "viewer"],
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
};

function b64url(o: object): string {
  return Buffer.from(JSON.stringify(o)).toString("base64url");
}

export function mintToken(persona: Persona): string {
  const u = PERSONAS[persona];
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url({
    sub: u.sub,
    iss: "civitasone-dev",
    tid: u.tenant ?? TENANT,
    tenantId: u.tenant ?? TENANT,
    sid: "a11y-gate",
    email: u.email,
    name: u.name,
    roles: u.roles,
    iat: now,
    exp: now + 60 * 60,
  });
  const sig = createHmac("sha256", SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${sig}`;
}

export async function authenticate(
  context: BrowserContext,
  persona: Persona,
  baseURL: string,
): Promise<void> {
  const url = new URL(baseURL);
  await context.clearCookies();
  await context.addCookies([
    {
      name: COOKIE,
      value: mintToken(persona),
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      // The app sets `secure: true`; Chromium permits secure cookies on
      // localhost over http, so this works for both local and HTTPS runs.
      secure: url.protocol === "https:",
      sameSite: "Lax",
    },
  ]);
}
