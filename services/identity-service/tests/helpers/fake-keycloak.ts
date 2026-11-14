/**
 * An in-memory Keycloak admin API for tests: just enough of the realm user / role-mapping / password endpoints
 * that shared/keycloak.ts calls. Records every request so tests can assert on what was (and was not) sent.
 */
import { vi } from "vitest";
import { randomUUID } from "node:crypto";

export type FakeUser = {
  id: string; username: string; email?: string; enabled: boolean; emailVerified?: boolean;
  firstName?: string; lastName?: string; attributes: Record<string, string[]>; requiredActions: string[]; roles: Set<string>; password?: boolean;
};
export type Call = { method: string; path: string; body: string };

export const KC_URL = "https://kc-fake.invalid/auth";
export const REALM_ROLES = [
  "employee", "manager", "hr_officer", "hr_admin", "finance_admin", "tenant_admin", "super_admin", "platform_admin", "dept_officer",
];

export function installFakeKeycloak(opts: { mailWorks?: boolean; policyRejects?: (pw: string) => boolean; failCleanup?: boolean } = {}) {
  const users = new Map<string, FakeUser>();
  const calls: Call[] = [];
  let seq = 0;
  const mailWorks = opts.mailWorks ?? true;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const fetchMock = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : init?.body ? String(init.body) : "";
    const path = url.pathname.replace("/auth", "");
    calls.push({ method, path: path + url.search, body });

    if (path.endsWith("/protocol/openid-connect/token")) return json({ access_token: "fake-admin-token", expires_in: 300 });

    const rolesIdx = path.match(/\/admin\/realms\/[^/]+\/roles\/([^/]+)$/);
    if (rolesIdx) {
      const name = decodeURIComponent(rolesIdx[1]!);
      return REALM_ROLES.includes(name) ? json({ id: `role-${name}`, name }) : new Response("{}", { status: 404 });
    }
    if (/\/admin\/realms\/[^/]+\/users$/.test(path) && method === "GET") {
      const q = url.searchParams.get("username");
      const hits = [...users.values()].filter((u) => u.username === q);
      return json(hits.map(rep));
    }
    if (/\/admin\/realms\/[^/]+\/users$/.test(path) && method === "POST") {
      const b = JSON.parse(body) as Partial<FakeUser>;
      seq++;
      const id = randomUUID();
      users.set(id, { id, username: b.username!, enabled: b.enabled ?? true, attributes: (b.attributes as Record<string, string[]>) ?? {}, requiredActions: [], roles: new Set(), ...(b.email ? { email: b.email } : {}) });
      return new Response(null, { status: 201 });
    }
    const um = path.match(/\/admin\/realms\/[^/]+\/users\/([^/]+)(\/.*)?$/);
    if (um) {
      const u = users.get(um[1]!);
      const sub = um[2] ?? "";
      if (!u) return new Response("{}", { status: 404 });
      if (sub === "" && method === "GET") return json(rep(u));
      if (sub === "" && method === "PUT") {
        const b = JSON.parse(body) as Partial<FakeUser>;
        if (opts.failCleanup && b.requiredActions) return new Response("{}", { status: 500 });
        if (b.email && [...users.values()].some((o) => o.id !== u.id && o.email?.toLowerCase() === b.email!.toLowerCase())) {
          return json({ errorMessage: "User exists with same email" }, 409);
        }
        if (b.email !== undefined) u.email = b.email;
        if (b.enabled !== undefined) u.enabled = b.enabled;
        if (b.emailVerified !== undefined) u.emailVerified = b.emailVerified;
        if (b.firstName !== undefined) u.firstName = b.firstName;
        if (b.lastName !== undefined) u.lastName = b.lastName;
        if (b.attributes) u.attributes = b.attributes as Record<string, string[]>;
        if (b.requiredActions) u.requiredActions = b.requiredActions as string[];
        return new Response(null, { status: 204 });
      }
      if (sub === "/role-mappings/realm/composite" && method === "GET") return json([...u.roles, "default-roles-civitasone", "offline_access", "uma_authorization"].map((name) => ({ id: `role-${name}`, name })));
      if (sub === "/role-mappings/realm" && method === "GET") return json([...u.roles].map((name) => ({ id: `role-${name}`, name })));
      if (sub === "/role-mappings/realm" && method === "POST") { for (const r of JSON.parse(body) as Array<{ name: string }>) u.roles.add(r.name); return new Response(null, { status: 204 }); }
      if (sub === "/role-mappings/realm" && method === "DELETE") { for (const r of JSON.parse(body) as Array<{ name: string }>) u.roles.delete(r.name); return new Response(null, { status: 204 }); }
      if (sub === "/credentials") return json(u.password ? [{ type: "password", id: "cred-1" }] : []);
      if (sub === "/logout") return new Response(null, { status: 204 });
      if (sub === "/reset-password") {
        const pw = (JSON.parse(body) as { value: string }).value;
        if (opts.policyRejects?.(pw)) return json({ error: "password_policy" }, 400);
        u.password = true;
        return new Response(null, { status: 204 });
      }
      if (sub.startsWith("/execute-actions-email")) return mailWorks ? new Response(null, { status: 204 }) : json({ errorMessage: "smtp" }, 500);
    }
    return new Response("{}", { status: 404 });
  });

  function rep(u: FakeUser) {
    return { id: u.id, username: u.username, enabled: u.enabled, email: u.email, attributes: u.attributes };
  }
  return { users, calls, fetchMock, byName: (n: string) => [...users.values()].find((u) => u.username === n) };
}
