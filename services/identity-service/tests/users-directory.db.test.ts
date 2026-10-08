/**
 * Shared user-directory endpoint (GAP-WORKFLOW-INSTANCES-DETAIL-01 /
 * GAP-PROJECTS-DETAIL-MEMBERS-01).
 *
 * GET /identity/users/directory — tenant-scoped, non-PII {id, displayName}
 * lookup usable by ANY authenticated tenant member (NOT admin-gated). Real
 * Postgres as the non-superuser app role (FORCE RLS), real Fastify.
 *
 * Asserts the NEW behaviour (these all fail on the old code, which had no such
 * route): ids-batch resolve, q-search, the 200-id / 2-char / 20-row caps, the
 * "exactly one of ids|q" rule, 401 without a token, and — critically — that a
 * caller in tenant A can NEVER read tenant B's names (cross-tenant denial),
 * even by passing B's ids verbatim.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { users } from "../src/modules/users/schema.js";

const SECRET = process.env.JWT_SECRET as string;
const TA = "d1540000-0000-4000-8000-0000000000a1";
const TB = "d1540000-0000-4000-8000-0000000000b1";
const ACTOR_A = "d154acc0-0000-4000-8000-0000000000a1";
const EMP_A = "d1541000-0000-4000-8000-00000000000a"; // Asha Rao, active, tenant A
const SUSP_A = "d1541000-0000-4000-8000-00000000000b"; // Bimal Das, suspended, tenant A
const USER_B = "d1541000-0000-4000-8000-00000000000c"; // Chandra Nair, active, tenant B
const uid = (n: number) => `d1543000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Any authenticated tenant member — a plain employee, NOT an admin.
const bearer = (tid = TA, roles: string[] = ["employee"]) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR_A, roles, tid } as never, SECRET)}`,
});

type AppT = Awaited<ReturnType<(typeof import("../src/app.js"))["buildApp"]>>;
let app: AppT;

async function wipe() {
  for (const t of [TA, TB]) {
    await runWithTenant(t, () => db.transaction((tx) => tx.delete(users).where(eq(users.tenantId, t))));
  }
}

async function seed() {
  await runWithTenant(TA, () =>
    db.transaction(async (tx) => {
      const mk = (id: string, name: string, email: string, empCode: string | null, status = "active") => ({
        id, tenantId: TA, name, email, empCode, status, createdBy: ACTOR_A, updatedBy: ACTOR_A,
      });
      await tx.insert(users).values([
        mk(EMP_A, "Asha Rao", "asha@dept.gov.in", "EA-1"),
        mk(SUSP_A, "Bimal Das", "bimal@dept.gov.in", "EA-2", "suspended"),
        ...Array.from({ length: 30 }, (_, i) =>
          mk(uid(i + 1), `Sharma ${String(i + 1).padStart(2, "0")}`, `sharma${i + 1}@dept.gov.in`, `S-${i + 1}`),
        ),
      ]);
    }),
  );
  await runWithTenant(TB, () =>
    db.transaction((tx) =>
      tx.insert(users).values({
        id: USER_B, tenantId: TB, name: "Chandra Nair", email: "chandra@other.gov.in",
        status: "active", createdBy: ACTOR_A, updatedBy: ACTOR_A,
      }),
    ),
  );
}

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  await wipe();
  await seed();
});
afterAll(async () => {
  await wipe();
  await app.close();
  await sqlClient.end();
});

const dir = (qs: string, headers = bearer()) =>
  app.inject({ method: "GET", url: `/identity/users/directory?${qs}`, headers });

describe("GET /identity/users/directory — auth", () => {
  it("401 without a token", async () => {
    const res = await app.inject({ method: "GET", url: `/identity/users/directory?ids=${EMP_A}` });
    expect(res.statusCode).toBe(401);
  });

  it("200 for a plain (non-admin) authenticated tenant member", async () => {
    const res = await dir(`ids=${EMP_A}`);
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /identity/users/directory — ids batch", () => {
  it("resolves ids to {id, displayName} and NOTHING else (no email/empCode/status)", async () => {
    const res = await dir(`ids=${EMP_A},${SUSP_A}`);
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    const asha = rows.find((r) => r.id === EMP_A)!;
    expect(asha).toEqual({ id: EMP_A, displayName: "Asha Rao" });
    // Non-PII: only two keys ever.
    for (const r of rows) expect(Object.keys(r).sort()).toEqual(["displayName", "id"]);
    // Includes a non-active user so a history row for a suspended actor still names them.
    expect(rows.some((r) => r.id === SUSP_A && r.displayName === "Bimal Das")).toBe(true);
  });

  it("silently omits unknown ids (fail-soft, never 404s the whole batch)", async () => {
    const res = await dir(`ids=${EMP_A},${uid(999)}`);
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual([EMP_A]);
  });

  it("400 for a non-UUID id", async () => {
    const res = await dir("ids=not-a-uuid");
    expect(res.statusCode).toBe(400);
  });

  it("400 for more than 200 ids", async () => {
    const many = Array.from({ length: 201 }, () => uid(1)).join(",");
    const res = await dir(`ids=${many}`);
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /identity/users/directory — q search", () => {
  it("matches on name, returns only active users, capped at 20", async () => {
    const res = await dir("q=Sharma");
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<{ id: string; displayName: string }>;
    expect(rows.length).toBe(20); // 30 Sharmas exist; capped
    expect(rows.every((r) => r.displayName.startsWith("Sharma"))).toBe(true);
  });

  it("does NOT match on email or empCode (no enumeration by prefix)", async () => {
    for (const q of ["asha@dept", "EA-1"]) {
      const res = await dir(`q=${q}`);
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toHaveLength(0);
    }
  });

  it("matches on name and returns only {id, displayName}", async () => {
    const res = await dir("q=Asha");
    expect(res.statusCode).toBe(200);
    const rows = res.json().data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ id: EMP_A, displayName: "Asha Rao" });
  });

  it("excludes non-active users from search", async () => {
    const res = await dir("q=Bimal");
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(0);
  });

  it("respects limit<=20", async () => {
    const res = await dir("q=Sharma&limit=5");
    expect(res.json().data).toHaveLength(5);
  });

  it("400 for q shorter than 2 chars", async () => {
    const res = await dir("q=a");
    expect(res.statusCode).toBe(400);
  });

  it("400 when neither ids nor q is given", async () => {
    const res = await dir("");
    expect(res.statusCode).toBe(400);
  });

  it("400 when BOTH ids and q are given", async () => {
    const res = await dir(`ids=${EMP_A}&q=Asha`);
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /identity/users/directory — cross-tenant denial", () => {
  it("a tenant-A caller cannot resolve a tenant-B id (RLS + explicit scope)", async () => {
    const res = await dir(`ids=${USER_B}`, bearer(TA));
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(0); // B's name never leaks to A
  });

  it("a tenant-A caller cannot find a tenant-B user by name", async () => {
    const res = await dir("q=Chandra", bearer(TA));
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(0);
  });

  it("the same id IS resolvable from inside tenant B", async () => {
    const res = await dir(`ids=${USER_B}`, bearer(TB));
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([{ id: USER_B, displayName: "Chandra Nair" }]);
  });
});
