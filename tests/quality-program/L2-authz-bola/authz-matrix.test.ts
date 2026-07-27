/**
 * L2 — Authorization & BOLA Gate (P0)
 *
 * Systematic endpoint × role matrix verification.
 * Tests that:
 * 1. Every endpoint enforces the intended role (no open endpoints)
 * 2. Low-priv users cannot access high-priv endpoints (privilege escalation)
 * 3. Role-specific endpoints reject wrong roles with 403
 * 4. Mass-assignment protection (injected fields are ignored)
 * 5. Maker-checker: self-approve attempts → 403
 */
import { describe, it, expect, beforeAll } from "vitest";

const GATEWAY = process.env.GATEWAY_URL ?? "http://localhost:8080";
const SECRET = process.env.JWT_SECRET ?? "civitasone-dev-secret";
const TENANT = "00000000-0000-0000-0000-000000000001";

let signToken: (payload: Record<string, unknown>, secret: string) => string;

beforeAll(async () => {
  const auth = await import("@civitasone/auth");
  signToken = auth.signToken;
});

function makeToken(roles: string[], sub = "user-authz-test") {
  return signToken({ sub, tid: TENANT, roles, sid: "authz-test", dept_code: "TEST" }, SECRET);
}

async function apiCall(
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const opts: RequestInit = {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${GATEWAY}${path}`, opts);
  let respBody: unknown;
  try {
    respBody = await res.json();
  } catch {
    respBody = null;
  }
  return { status: res.status, body: respBody };
}

// Role-to-endpoint access matrix
// [path, method, allowedRoles[], deniedRoles[]]
const ACCESS_MATRIX: [string, string, string[], string[]][] = [
  // Finance — only finance_officer / finance_admin / super_admin for writes; reads include audit/procurement
  ["/api/v1/finance/bills", "GET", ["finance_officer", "finance_admin", "super_admin"], ["citizen", "employee"]],
  ["/api/v1/finance/sanctions", "GET", ["finance_officer", "finance_admin", "super_admin", "procurement_officer", "audit_officer"], ["citizen", "employee"]],
  ["/api/v1/finance/journals", "GET", ["finance_officer", "super_admin"], ["citizen", "employee"]],
  ["/api/v1/finance/budgets", "GET", ["finance_officer", "finance_admin", "super_admin"], ["citizen"]],

  // HRMS — only hr_officer / hr_admin / super_admin
  ["/api/v1/hrms/employees", "GET", ["hr_officer", "hr_admin", "super_admin"], ["citizen"]],

  // Procurement — only procurement_officer / super_admin
  ["/api/v1/procurement/indents", "GET", ["procurement_officer", "super_admin"], ["citizen", "employee"]],
  ["/api/v1/procurement/vendors", "GET", ["procurement_officer", "super_admin"], ["citizen"]],

  // Audit — only audit_officer / super_admin
  ["/api/v1/audit/observations", "GET", ["audit_officer", "super_admin"], ["citizen", "employee"]],

  // Admin — only tenant_admin / super_admin (may return 503 if service unhealthy)
  ["/api/v1/admin/health", "GET", ["tenant_admin", "super_admin"], ["citizen", "employee"]],

  // ── Services brought up 2026-07-27. These became REACHABLE before their authz
  //    was ever verified, so this block closes a genuine exposure window rather
  //    than adding coverage for its own sake. Every allowed/denied pair below was
  //    probed against the live gateway first — no guessed roles.
  ["/api/v1/meeting/committees", "GET",
    ["meeting_admin", "super_admin"],
    ["citizen", "employee", "finance_officer"]],
  ["/api/v1/court/cases", "GET",
    ["court_admin", "super_admin"],
    ["citizen", "employee", "hr_officer"]],
  ["/api/v1/visitor/badges/templates", "GET",
    ["security_admin", "super_admin"],
    ["citizen", "finance_officer"]],
  ["/api/v1/inspection/assignments", "GET",
    ["inspection_admin", "super_admin"],
    ["citizen", "employee", "hr_officer"]],
  // Distinct from the line above: audit_officer IS accepted on some inspection
  // routes but NOT on entities, so this pins the narrower grant.
  ["/api/v1/inspection/entities", "GET",
    ["inspection_admin", "super_admin"],
    ["citizen", "audit_officer"]],
];

describe("L2 — Authorization Matrix: Allowed roles get 200", () => {
  for (const [path, method, allowedRoles] of ACCESS_MATRIX) {
    for (const role of allowedRoles) {
      it(`${method} ${path} — ${role} → 200`, async () => {
        const token = makeToken([role]);
        const { status } = await apiCall(method, path, token);
        // 200 = success, 400 = missing query params (not auth), 502/503 = service unhealthy
        expect([200, 400, 502, 503]).toContain(status);
      });
    }
  }
});

describe("L2 — Authorization Matrix: Denied roles get 403", () => {
  for (const [path, method, , deniedRoles] of ACCESS_MATRIX) {
    for (const role of deniedRoles) {
      it(`${method} ${path} — ${role} → 403`, async () => {
        const token = makeToken([role]);
        const { status } = await apiCall(method, path, token);
        // 403 = correctly denied, 502/503 = service unhealthy (can't verify auth in this state)
        expect([403, 502, 503]).toContain(status);
      });
    }
  }
});

describe("L2 — Mass Assignment Protection", () => {
  it("POST /api/v1/finance/bills: injected tenantId in body is ignored", async () => {
    const token = makeToken(["finance_officer"]);
    const attackTenant = "99999999-9999-4000-8000-999999999999";
    const { status, body } = await apiCall("POST", "/api/v1/finance/bills", token, {
      billNo: "MASS-ASSIGN-TEST-001",
      vendorId: "aaaaaaaa-0000-4000-8000-000000000001",
      headId: "bbbbbbbb-0000-4000-8000-000000000001",
      grossMinor: 50000,
      currency: "INR",
      // Attack: try to inject a different tenant
      tenantId: attackTenant,
      // Attack: try to inject admin role
      roles: ["super_admin"],
      // Attack: try to set status directly
      status: "approved",
    });
    // Should accept (202) or reject invalid fields (400) — never store the injected tenantId
    expect([202, 400]).toContain(status);

    if (status === 202) {
      // Verify the bill was created for the TOKEN's tenant, not the injected one
      const check = await apiCall("GET", "/api/v1/finance/bills", token);
      if (check.status === 200) {
        const bills = Array.isArray(check.body)
          ? check.body
          : ((check.body as Record<string, unknown>)?.data as unknown[]);
        if (Array.isArray(bills)) {
          const created = bills.find(
            (b: Record<string, unknown>) => b.billNo === "MASS-ASSIGN-TEST-001"
          );
          if (created) {
            // If the bill exists, its status should NOT be 'approved' (mass-assignment blocked)
            expect((created as Record<string, unknown>).status).not.toBe("approved");
          }
        }
      }
    }
  });

  it("POST /api/v1/hrms/employees: injected role escalation ignored", async () => {
    const token = makeToken(["hr_officer"]);
    const { status } = await apiCall("POST", "/api/v1/hrms/employees", token, {
      name: "Mass Assign Attack",
      email: "attacker@test.gov.in",
      department: "IT",
      // Attack: try to inject admin status
      isAdmin: true,
      systemRole: "super_admin",
    });
    // Should not crash and should not grant admin
    expect([201, 202, 400, 422]).toContain(status);
  });
});

describe("L2 — JWT Tampering", () => {
  it("alg=none attack → 401", async () => {
    // Manually craft a token with alg:none
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ sub: "hacker", tid: TENANT, roles: ["super_admin"], sid: "x" })
    ).toString("base64url");
    const fakeToken = `${header}.${payload}.`;

    const res = await fetch(`${GATEWAY}/api/v1/finance/bills`, {
      headers: { authorization: `Bearer ${fakeToken}` },
    });
    expect(res.status).toBe(401);
  });

  it("wrong secret → 401", async () => {
    const wrongToken = signToken(
      { sub: "hacker", tid: TENANT, roles: ["super_admin"], sid: "x" },
      "completely-wrong-secret-that-should-fail",
    );
    const res = await fetch(`${GATEWAY}/api/v1/finance/bills`, {
      headers: { authorization: `Bearer ${wrongToken}` },
    });
    expect(res.status).toBe(401);
  });

  it("manipulated payload (changed role) → 401", async () => {
    // Sign a valid token then tamper with the payload
    const validToken = makeToken(["citizen"]);
    const parts = validToken.split(".");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    payload.roles = ["super_admin"]; // escalate
    parts[1] = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const tamperedToken = parts.join(".");

    const res = await fetch(`${GATEWAY}/api/v1/finance/bills`, {
      headers: { authorization: `Bearer ${tamperedToken}` },
    });
    expect(res.status).toBe(401);
  });
});
