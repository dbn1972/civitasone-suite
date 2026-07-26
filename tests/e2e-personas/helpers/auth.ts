/**
 * Persona authentication for E2E journeys.
 *
 * Reuses the same cookie-minting approach as the a11y gate (direct HS256 JWT,
 * no form submission), since DEV_LOGIN_PASSWORD is unset on this box.
 */
import { createHmac } from "node:crypto";
import type { Page, BrowserContext } from "@playwright/test";

const SECRET = process.env.JWT_SECRET ?? "civitasone-dev-secret";
const TENANT1 = "00000000-0000-0000-0000-000000000001";
const TENANT2 = "00000000-0000-0000-0000-000000000002";
const COOKIE = "civitasone_at";

export type PersonaName =
  | "superadmin"
  | "commissioner"
  | "hrofficer"
  | "financeofficer"
  | "financeadmin"
  | "procurementofficer"
  | "auditor"
  | "legalofficer"
  | "inspector"
  | "grievanceofficer"
  | "citizen"
  | "dataprincipal"
  | "partnerofficer";

type PersonaDef = {
  sub: string;
  name: string;
  email: string;
  roles: string[];
  tenant: string;
  deptCode?: string;
};

export const PERSONAS: Record<PersonaName, PersonaDef> = {
  superadmin: {
    sub: "00000000-0000-0000-0000-000000000099",
    name: "Super Admin",
    email: "superadmin@demo.gov.in",
    roles: [
      "super_admin", "platform_admin", "admin", "tenant_admin",
      "finance_admin", "hr_admin", "procurement_admin", "audit_admin",
      "legal_admin", "project_admin", "grant_admin", "asset_admin",
      "stock_admin", "crm_admin", "helpdesk_admin", "estab_admin",
      "reader", "viewer", "officer",
    ],
    tenant: TENANT1,
  },
  commissioner: {
    sub: "0de00000-0000-0000-0000-000000000001",
    name: "Municipal Commissioner",
    email: "commissioner@demo.gov.in",
    roles: ["tenant_admin", "admin"],
    tenant: TENANT1,
  },
  hrofficer: {
    sub: "0de00000-0000-0000-0000-000000000002",
    name: "HR / Establishment Officer",
    email: "hrofficer@demo.gov.in",
    roles: ["hr_officer", "hr_admin", "estab_officer"],
    tenant: TENANT1,
    deptCode: "HR",
  },
  financeofficer: {
    sub: "0de00000-0000-0000-0000-000000000003",
    name: "Finance / Budget Officer",
    email: "financeofficer@demo.gov.in",
    roles: ["finance_officer", "budget_officer"],
    tenant: TENANT1,
    deptCode: "FIN",
  },
  financeadmin: {
    sub: "0de00000-0000-0000-0000-000000000004",
    name: "Chief Accounts Officer",
    email: "financeadmin@demo.gov.in",
    roles: ["finance_admin"],
    tenant: TENANT1,
    deptCode: "FIN",
  },
  procurementofficer: {
    sub: "0de00000-0000-0000-0000-000000000005",
    name: "Procurement Officer",
    email: "procurementofficer@demo.gov.in",
    roles: ["procurement_officer", "procurement_admin"],
    tenant: TENANT1,
    deptCode: "PROC",
  },
  auditor: {
    sub: "0de00000-0000-0000-0000-000000000006",
    name: "Internal Auditor",
    email: "auditor@demo.gov.in",
    roles: ["audit_officer", "audit_admin", "reader", "viewer"],
    tenant: TENANT1,
  },
  legalofficer: {
    sub: "0de00000-0000-0000-0000-000000000007",
    name: "Law Officer",
    email: "legalofficer@demo.gov.in",
    roles: ["legal_officer", "legal_admin"],
    tenant: TENANT1,
  },
  inspector: {
    sub: "0de00000-0000-0000-0000-000000000008",
    name: "Field Inspector",
    email: "inspector@demo.gov.in",
    roles: ["inspector", "inspection_admin"],
    tenant: TENANT1,
  },
  grievanceofficer: {
    sub: "0de00000-0000-0000-0000-000000000009",
    name: "Grievance / Dept Officer",
    email: "grievanceofficer@demo.gov.in",
    roles: ["grievance_officer", "citizen_officer", "dept_officer"],
    tenant: TENANT1,
    deptCode: "CIT",
  },
  citizen: {
    sub: "0de00000-0000-0000-0000-00000000000a",
    name: "Citizen (Public User)",
    email: "citizen@demo.gov.in",
    roles: ["citizen"],
    tenant: TENANT1,
  },
  dataprincipal: {
    sub: "0de00000-0000-0000-0000-00000000000b",
    name: "Data Principal (Consent)",
    email: "dataprincipal@demo.gov.in",
    roles: ["data_principal", "citizen"],
    tenant: TENANT1,
  },
  partnerofficer: {
    sub: "0de00000-0000-0000-0000-00000000000c",
    name: "Partner Dept Officer",
    email: "partnerofficer@demo.gov.in",
    roles: ["tenant_admin", "dept_officer", "citizen_officer"],
    tenant: TENANT2,
  },
};

function b64url(o: object): string {
  return Buffer.from(JSON.stringify(o)).toString("base64url");
}

export function mintToken(persona: PersonaName): string {
  const u = PERSONAS[persona];
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url({
    sub: u.sub,
    iss: "civitasone-dev",
    tid: u.tenant,
    tenantId: u.tenant,
    sid: "e2e",
    email: u.email,
    name: u.name,
    roles: u.roles,
    ...(u.deptCode ? { dept_code: u.deptCode } : {}),
    iat: now,
    exp: now + 60 * 60,
  });
  const sig = createHmac("sha256", SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${sig}`;
}

export async function loginAs(
  page: Page,
  persona: PersonaName,
  baseURL?: string,
): Promise<void> {
  const u = PERSONAS[persona];
  const urlStr = baseURL || page.url() || "http://localhost:3000";
  const url = new URL(urlStr);
  await page.context().clearCookies();
  await page.context().addCookies([
    {
      name: COOKIE,
      value: mintToken(persona),
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "Lax",
    },
  ]);
}

/**
 * Mint a Bearer token for direct API calls (headless, no browser).
 */
export function apiToken(persona: PersonaName): string {
  return mintToken(persona);
}

export function tenantHeader(persona: PersonaName): Record<string, string> {
  return { "x-tenant-id": PERSONAS[persona].tenant };
}
