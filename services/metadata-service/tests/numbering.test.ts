/**
 * Generic numbering capability (CAP-032) — live-Postgres integration tests
 * against RLS ENABLE+FORCE with a NOBYPASSRLS role.
 *
 * Proves: config-driven formats + maker-checker, GAPLESS allocation under
 * concurrency (unique + contiguous, no gaps/dupes), reset-policy correctness
 * (FY / monthly rollover resets the counter), and cross-tenant RLS isolation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const A = randomUUID();
const B = randomUUID();
const MAKER = randomUUID();
const CHECKER = randomUUID();

function token(tid: string, actor: string, roles: string[] = ["metadata_admin"]): string {
  return signToken({ sub: actor, tid, roles, sid: "sess" }, SECRET);
}
function hdr(tid: string, actor: string, roles?: string[]) {
  return { authorization: `Bearer ${token(tid, actor, roles)}`, "content-type": "application/json" };
}
function auth(tid: string, actor: string, roles?: string[]) {
  return { authorization: `Bearer ${token(tid, actor, roles)}` };
}

async function definePublished(
  tid: string,
  formatKey: string,
  spec: Record<string, unknown>,
): Promise<string> {
  const create = await app.inject({
    method: "POST", url: "/v1/metadata/number-formats", headers: hdr(tid, MAKER),
    body: JSON.stringify({ formatKey, label: formatKey, ...spec }),
  });
  expect(create.statusCode).toBe(201);
  const id = create.json().data.id as string;
  const pub = await app.inject({ method: "POST", url: `/v1/metadata/number-formats/${id}/publish`, headers: auth(tid, CHECKER) });
  expect(pub.statusCode).toBe(200);
  expect(pub.json().data.status).toBe("active");
  return id;
}

let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); });

afterAll(async () => {
  await app.close();
  for (const tid of [A, B]) {
    await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${tid}, true)`;
      await sql`DELETE FROM metadata.number_sequences WHERE tenant_id = ${tid}`;
      await sql`DELETE FROM metadata.number_formats WHERE tenant_id = ${tid}`;
    });
  }
  await sqlClient.end();
});

describe("auth + validation", () => {
  it("rejects unauthenticated allocation", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/metadata/numbers/allocate", headers: { "content-type": "application/json" }, body: JSON.stringify({ formatKey: "x.y" }) });
    expect(res.statusCode).toBe(401);
  });
  it("400 on a malformed format key", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/metadata/number-formats", headers: hdr(A, MAKER), body: JSON.stringify({ formatKey: "NotDotted", label: "x" }) });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("FORMAT_KEY_INVALID");
  });
});

describe("maker-checker on format definition", () => {
  it("author cannot publish their own format; a different admin can", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/metadata/number-formats", headers: hdr(A, MAKER), body: JSON.stringify({ formatKey: "test.mc", label: "MC", prefix: "MC" }) });
    expect(create.statusCode).toBe(201);
    expect(create.json().data.status).toBe("draft");
    const id = create.json().data.id;

    const self = await app.inject({ method: "POST", url: `/v1/metadata/number-formats/${id}/publish`, headers: auth(A, MAKER) });
    expect(self.statusCode).toBe(403);
    expect(self.json().code).toBe("MAKER_CANNOT_CHECK");

    const ok = await app.inject({ method: "POST", url: `/v1/metadata/number-formats/${id}/publish`, headers: auth(A, CHECKER) });
    expect(ok.statusCode).toBe(200);

    // Editing an active format is rejected.
    const edit = await app.inject({ method: "PATCH", url: `/v1/metadata/number-formats/${id}`, headers: hdr(A, CHECKER), body: JSON.stringify({ prefix: "XX" }) });
    expect(edit.statusCode).toBe(409);
    expect(edit.json().code).toBe("FORMAT_NOT_DRAFT");
  });

  it("allocation requires an active format", async () => {
    const create = await app.inject({ method: "POST", url: "/v1/metadata/number-formats", headers: hdr(A, MAKER), body: JSON.stringify({ formatKey: "test.inactive", label: "x", prefix: "IN" }) });
    expect(create.statusCode).toBe(201);
    const res = await app.inject({ method: "POST", url: "/v1/metadata/numbers/allocate", headers: hdr(A, MAKER), body: JSON.stringify({ formatKey: "test.inactive" }) });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("FORMAT_NOT_ACTIVE");
  });
});

describe("formatting + reset policy", () => {
  it("formats prefix + FY + zero-padded counter", async () => {
    await definePublished(A, "test.po", { prefix: "PO", counterWidth: 6, resetPolicy: "yearly", embedFinancialYear: true });
    const res = await app.inject({ method: "POST", url: "/v1/metadata/numbers/allocate", headers: hdr(A, MAKER), body: JSON.stringify({ formatKey: "test.po", at: "2026-07-01T00:00:00.000Z" }) });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.reference).toBe("PO/2026-27/000001");
    expect(res.json().data.bucket).toBe("2026-27");
  });

  it("yearly (FY) rollover resets the counter to 1", async () => {
    await definePublished(A, "test.fy", { prefix: "FY", counterWidth: 4, resetPolicy: "yearly", embedFinancialYear: true });
    const a1 = await app.inject({ method: "POST", url: "/v1/metadata/numbers/allocate", headers: hdr(A, MAKER), body: JSON.stringify({ formatKey: "test.fy", at: "2026-07-01T00:00:00.000Z" }) });
    const a2 = await app.inject({ method: "POST", url: "/v1/metadata/numbers/allocate", headers: hdr(A, MAKER), body: JSON.stringify({ formatKey: "test.fy", at: "2026-08-01T00:00:00.000Z" }) });
    const b1 = await app.inject({ method: "POST", url: "/v1/metadata/numbers/allocate", headers: hdr(A, MAKER), body: JSON.stringify({ formatKey: "test.fy", at: "2027-05-01T00:00:00.000Z" }) });
    expect(a1.json().data.reference).toBe("FY/2026-27/0001");
    expect(a2.json().data.reference).toBe("FY/2026-27/0002");
    expect(b1.json().data.reference).toBe("FY/2027-28/0001"); // new FY bucket resets to 1
  });

  it("monthly rollover resets the counter", async () => {
    await definePublished(A, "test.mo", { prefix: "MO", counterWidth: 3, resetPolicy: "monthly", embedFinancialYear: false });
    const jul = await app.inject({ method: "POST", url: "/v1/metadata/numbers/allocate", headers: hdr(A, MAKER), body: JSON.stringify({ formatKey: "test.mo", at: "2026-07-15T00:00:00.000Z" }) });
    const aug = await app.inject({ method: "POST", url: "/v1/metadata/numbers/allocate", headers: hdr(A, MAKER), body: JSON.stringify({ formatKey: "test.mo", at: "2026-08-15T00:00:00.000Z" }) });
    expect(jul.json().data.bucket).toBe("2026-07");
    expect(aug.json().data.bucket).toBe("2026-08");
    expect(aug.json().data.sequence).toBe("1");
  });

  it("never policy keeps one monotonic series across years", async () => {
    await definePublished(A, "test.never", { prefix: "NV", counterWidth: 5, resetPolicy: "never" });
    const y1 = await app.inject({ method: "POST", url: "/v1/metadata/numbers/allocate", headers: hdr(A, MAKER), body: JSON.stringify({ formatKey: "test.never", at: "2026-07-01T00:00:00.000Z" }) });
    const y2 = await app.inject({ method: "POST", url: "/v1/metadata/numbers/allocate", headers: hdr(A, MAKER), body: JSON.stringify({ formatKey: "test.never", at: "2030-07-01T00:00:00.000Z" }) });
    expect(y1.json().data.sequence).toBe("1");
    expect(y2.json().data.sequence).toBe("2"); // ALL bucket, no reset
  });
});

describe("GAPLESS under concurrency", () => {
  it("N concurrent allocations are unique and contiguous (no gaps, no dupes)", async () => {
    await definePublished(A, "test.concurrent", { prefix: "CC", counterWidth: 6, resetPolicy: "yearly", embedFinancialYear: true });
    const N = 40;
    const at = "2026-07-01T00:00:00.000Z";
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        app.inject({ method: "POST", url: "/v1/metadata/numbers/allocate", headers: hdr(A, MAKER), body: JSON.stringify({ formatKey: "test.concurrent", at }) }),
      ),
    );
    for (const r of results) expect(r.statusCode).toBe(201);
    const seqs = results.map((r) => Number(r.json().data.sequence)).sort((a, b) => a - b);
    const refs = results.map((r) => r.json().data.reference);
    expect(new Set(refs).size).toBe(N);            // all unique
    expect(seqs).toEqual(Array.from({ length: N }, (_, i) => i + 1)); // contiguous 1..N
  });
});

describe("cross-tenant RLS isolation", () => {
  it("tenant B cannot see or allocate tenant A's format", async () => {
    await definePublished(A, "test.isolation", { prefix: "IS", counterWidth: 4 });
    // B allocation of A's key -> 404 (row invisible under RLS)
    const balloc = await app.inject({ method: "POST", url: "/v1/metadata/numbers/allocate", headers: hdr(B, MAKER), body: JSON.stringify({ formatKey: "test.isolation" }) });
    expect(balloc.statusCode).toBe(404);
    expect(balloc.json().code).toBe("FORMAT_NOT_FOUND");
    // B's format list excludes A's formats
    const blist = await app.inject({ method: "GET", url: "/v1/metadata/number-formats", headers: hdr(B, MAKER) });
    expect(blist.statusCode).toBe(200);
    expect(blist.json().data.some((f: { formatKey: string }) => f.formatKey === "test.isolation")).toBe(false);
  });
});

describe("allocation RBAC", () => {
  it("a data-role user (not schema admin) can allocate", async () => {
    await definePublished(A, "test.datarole", { prefix: "DR", counterWidth: 4 });
    const res = await app.inject({ method: "POST", url: "/v1/metadata/numbers/allocate", headers: hdr(A, MAKER, ["metadata_user"]), body: JSON.stringify({ formatKey: "test.datarole" }) });
    expect(res.statusCode).toBe(201);
  });
});
