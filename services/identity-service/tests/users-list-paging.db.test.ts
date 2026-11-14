/**
 * Explicit, safe paging for the admin user list (UAT 11 Nov 2026: Digital India Corporation).
 *
 * GET /identity/users and GET /identity/users/search are what /api/v1/admin/users[/search] reach
 * through the gateway. Contract pinned here: limit is 1..200 and anything above is a clear 400
 * (never an empty list), offset pages, the list carries X-Total-Count / X-Next-Offset headers
 * (body stays a bare array) and search carries total / hasMore / nextOffset, order is stable so
 * walking the pages yields every user exactly once, and a tenant only ever sees its own users.
 * Real Postgres as the non-superuser app role (FORCE RLS), real Fastify.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { users } from "../src/modules/users/schema.js";
import { nextOffset } from "../src/modules/users/routes.js";

const SECRET = process.env.JWT_SECRET as string;
const TA = "d1610000-0000-4000-8000-0000000000a1";
const TB = "d1610000-0000-4000-8000-0000000000b1";
const ACTOR = "d161acc0-0000-4000-8000-0000000000a1";
const TOTAL_A = 201; // one more than the 200 page cap
const uid = (n: number) => `d1613000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const UID_B = "d1614000-0000-4000-8000-000000000001";

const bearer = (roles: string[], tid = TA) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, roles, tid } as never, SECRET)}` });
const admin = bearer(["tenant_admin"]);

type AppT = Awaited<ReturnType<(typeof import("../src/app.js"))["buildApp"]>>;
let app: AppT;

async function wipe() {
  for (const t of [TA, TB]) {
    await runWithTenant(t, () => db.transaction((tx) => tx.delete(users).where(eq(users.tenantId, t))));
  }
}

const list = (qs: string, headers: Record<string, string> = admin) =>
  app.inject({ method: "GET", url: `/identity/users${qs ? `?${qs}` : ""}`, headers });
const search = (qs: string, headers: Record<string, string> = admin) =>
  app.inject({ method: "GET", url: `/identity/users/search${qs ? `?${qs}` : ""}`, headers });

beforeAll(async () => {
  await wipe();
  await runWithTenant(TA, () => db.transaction((tx) => tx.insert(users).values(
    Array.from({ length: TOTAL_A }, (_, i) => ({
      id: uid(i + 1), tenantId: TA, name: `Person ${String(i + 1).padStart(3, "0")}`,
      email: `person${i + 1}@dept.gov.in`, empCode: `P-${i + 1}`, status: "active", createdBy: ACTOR, updatedBy: ACTOR,
    })),
  )));
  await runWithTenant(TB, () => db.transaction((tx) => tx.insert(users).values({
    id: UID_B, tenantId: TB, name: "Other Tenant", email: "other@else.gov.in", status: "active", createdBy: ACTOR, updatedBy: ACTOR,
  })));
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
});

afterAll(async () => {
  await wipe();
  await app.close();
});

describe("nextOffset", () => {
  it("is null on the last page, past the end and for an empty page; otherwise the next start", () => {
    expect(nextOffset(0, 200, 201)).toBe(200);
    expect(nextOffset(200, 1, 201)).toBeNull();
    expect(nextOffset(0, 200, 200)).toBeNull();
    expect(nextOffset(500, 0, 201)).toBeNull();
    expect(nextOffset(0, 0, 0)).toBeNull();
  });
});

describe("GET /identity/users paging", () => {
  it("returns the first 200 of 201 at the cap, with the total and where the next page starts", async () => {
    const res = await list("limit=200");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(200);
    expect(res.headers["x-total-count"]).toBe("201");
    expect(res.headers["x-limit"]).toBe("200");
    expect(res.headers["x-offset"]).toBe("0");
    expect(res.headers["x-next-offset"]).toBe("200");
  });

  it("the 201st user is on the next page, which has no next", async () => {
    const res = await list("limit=200&offset=200");
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ id: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(uid(201));
    expect(res.headers["x-total-count"]).toBe("201");
    expect(res.headers["x-next-offset"]).toBeUndefined();
  });

  it("limit 201 is refused with a clear 400 naming the maximum (not an empty list)", async () => {
    const res = await list("limit=201");
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain("limit must be at most 200");
  });

  it("limit 1000 is a clear 400 as well, never an empty 200", async () => {
    const res = await list("limit=1000");
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain("limit must be at most 200");
    expect(Array.isArray(res.json())).toBe(false);
  });

  it("offset past the end is an empty page that still reports the total and no next offset", async () => {
    const res = await list("limit=50&offset=5000");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    expect(res.headers["x-total-count"]).toBe("201");
    expect(res.headers["x-next-offset"]).toBeUndefined();
  });

  it("refuses limit 0, a non-numeric limit, a fractional limit and a negative offset with 400", async () => {
    for (const qs of ["limit=0", "limit=abc", "limit=1.5", "offset=-1", "offset=x"]) {
      expect((await list(qs)).statusCode, qs).toBe(400);
    }
  });

  it("walking the pages by X-Next-Offset yields every user exactly once, in a stable order", async () => {
    const seen: string[] = [];
    let offset: string | undefined = "0";
    let guard = 0;
    while (offset !== undefined && guard++ < 20) {
      const res = await list(`limit=50&offset=${offset}`);
      expect(res.statusCode).toBe(200);
      for (const r of res.json() as Array<{ id: string }>) seen.push(r.id);
      offset = res.headers["x-next-offset"] as string | undefined;
    }
    expect(seen).toHaveLength(TOTAL_A);
    expect(new Set(seen).size).toBe(TOTAL_A);
    expect(seen[0]).toBe(uid(1));
    expect(seen[TOTAL_A - 1]).toBe(uid(TOTAL_A));
  });

  it("counts only the caller's own tenant, and a non-admin role is refused", async () => {
    const b = await list("limit=10", bearer(["tenant_admin"], TB));
    expect(b.statusCode).toBe(200);
    expect((b.json() as unknown[]).length).toBe(1);
    expect(b.headers["x-total-count"]).toBe("1");
    expect((await list("limit=10", bearer(["employee"]))).statusCode).toBe(403);
  });
});

describe("GET /identity/users/search paging", () => {
  it("reports total, limit, offset, hasMore and nextOffset at the 200/201 boundary", async () => {
    const first = (await search("limit=200")).json();
    expect(first.rows).toHaveLength(200);
    expect(first).toMatchObject({ total: 201, limit: 200, offset: 0, hasMore: true, nextOffset: 200 });
    const second = (await search("limit=200&offset=200")).json();
    expect(second.rows).toHaveLength(1);
    expect(second).toMatchObject({ total: 201, offset: 200, hasMore: false, nextOffset: null });
  });

  it("limit 201 / 1000 are clear 400s; offset past the end is an empty page with the real total", async () => {
    for (const lim of ["201", "1000"]) {
      const res = await search(`limit=${lim}`);
      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(res.json())).toContain("limit must be at most 200");
    }
    const past = await search("limit=25&offset=9999");
    expect(past.statusCode).toBe(200);
    expect(past.json()).toMatchObject({ rows: [], total: 201, hasMore: false, nextOffset: null });
  });

  it("a filtered search pages against its own total", async () => {
    const res = (await search("q=Person%201&limit=10")).json(); // Person 100..199 (+ none else) match "Person 1"
    expect(res.total).toBe(100);
    expect(res.rows).toHaveLength(10);
    expect(res).toMatchObject({ hasMore: true, nextOffset: 10 });
  });
});
