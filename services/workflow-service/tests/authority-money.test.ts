/**
 * CAP-025 / Money (R7) — authority_limits.max_amount round-trips as an exact
 * bigint (paise), never a JS number. The column is `bigint("max_amount",
 * { mode: "bigint" })` (migration 0032_money_bigint_paise.sql); a `mode:
 * "number"` (or any Number() coercion on the read path) silently loses
 * precision above 2^53 (~₹9,007 cr) — this is exactly the bug the CAP-025
 * matrix must never reintroduce for a sovereign-scale authority ceiling.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAuthorityConsumers } from "../src/modules/authority/consumer.js";
import * as repo from "../src/modules/authority/repo.js";
import { evaluateAuthority } from "../src/modules/authority/domain.js";
import { asTenant } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "b5000000-1111-4000-8000-000000000001";
const MAKER = "b5000000-2222-4000-8000-000000000001";

// Above Number.MAX_SAFE_INTEGER (2^53 - 1) — a value that float64/JS number
// cannot represent exactly.
const ABOVE_2_53 = 9_007_199_254_740_993n;

function token(actorId = MAKER, roles = ["workflow_admin"]) {
  return signToken({ sub: actorId, tid: TENANT, roles, sid: "s" }, SECRET);
}

registerAuthorityConsumers(queue);
await queue.start();

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 3000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

afterAll(async () => {
  await db.execute(sql`DELETE FROM workflow.authority_limits WHERE tenant_id = ${TENANT}`);
  await sqlClient.end();
});

describe("authority_limits.max_amount — exact bigint round-trip (repo layer)", () => {
  it("persists and reads back a value above 2^53 exactly, typed as bigint", async () => {
    const row = await asTenant(TENANT, () =>
      repo.create({
        tenantId: TENANT,
        scopeType: "role",
        scopeRef: "board",
        authorityType: "financial",
        currency: "INR",
        maxAmount: ABOVE_2_53,
        effectiveFrom: "2025-01-01",
        effectiveTo: null,
        escalateToScopeType: null,
        escalateToRef: null,
        reason: null,
        createdBy: MAKER,
      }),
    );

    expect(typeof row.maxAmount).toBe("bigint");
    expect(row.maxAmount).toBe(ABOVE_2_53);
    // Proves Number() would have corrupted it (loses the last bit).
    expect(BigInt(Number(ABOVE_2_53))).not.toBe(ABOVE_2_53);

    const fetched = await asTenant(TENANT, () => repo.findById(row.id, TENANT));
    expect(fetched?.maxAmount).toBe(ABOVE_2_53);
    expect(typeof fetched?.maxAmount).toBe("bigint");
  });

  it("toDomain() maps the row without a Number() coercion", async () => {
    const created = await asTenant(TENANT, async () => {
      const r = await repo.create({
        tenantId: TENANT, scopeType: "role", scopeRef: "board-domain",
        authorityType: "financial", currency: "INR", maxAmount: ABOVE_2_53,
        effectiveFrom: "2025-01-01", effectiveTo: null,
        escalateToScopeType: null, escalateToRef: null, reason: null, createdBy: MAKER,
      });
      await repo.approve(r.id, TENANT, "b5000000-2222-4000-8000-000000000002");
      return r;
    });
    const active = await asTenant(TENANT, () => repo.activeLimits(TENANT));
    const found = active.find((l) => l.id === created.id);
    expect(found).toBeDefined();
    expect(typeof found!.maxAmount).toBe("bigint");
    expect(found!.maxAmount).toBe(ABOVE_2_53);
  });

  it("evaluateAuthority compares bigint amounts above 2^53 without precision loss", () => {
    const limit = {
      id: "x", scopeType: "role" as const, scopeRef: "board", authorityType: "financial" as const,
      currency: "INR", maxAmount: ABOVE_2_53, effectiveFrom: "2020-01-01", effectiveTo: null,
      escalateToScopeType: null, escalateToRef: null, status: "active",
    };
    const actor = { scopes: [{ scopeType: "role" as const, scopeRef: "board" }] };
    const withinLimit = evaluateAuthority([limit], actor, "financial", ABOVE_2_53, "2025-01-01");
    expect(withinLimit.withinActorAuthority).toBe(true);
    const oneOver = evaluateAuthority([limit], actor, "financial", ABOVE_2_53 + 1n, "2025-01-01");
    expect(oneOver.withinActorAuthority).toBe(false);
  });
});

describe("authority_limits.max_amount — exact bigint round-trip (HTTP layer)", () => {
  it("create → approve → list carries the exact paise string through JSON, no precision loss", async () => {
    const app = await buildApp();
    const create = await app.inject({
      method: "POST", url: "/v1/workflow/authority/limits",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        scopeType: "role", scopeRef: "http-board", authorityType: "financial",
        maxAmount: ABOVE_2_53.toString(), effectiveFrom: "2025-01-01",
      },
    });
    expect(create.statusCode).toBe(202);
    const { id } = create.json();

    const draft = await waitFor(async () => {
      const g = await app.inject({
        method: "GET", url: "/v1/workflow/authority/limits",
        headers: { authorization: `Bearer ${token()}` },
      });
      const rows = g.json().data as Array<{ id: string; maxAmount: string }>;
      return rows.find((l) => l.id === id) ?? null;
    });
    // A base-10 string on the wire, not a JS number (JSON.parse would corrupt
    // a number literal above 2^53; the maxAmount is read back off the GET
    // response and compared as a string to prove the raw wire representation
    // is a string, not a corrupted float).
    expect(draft.maxAmount).toBe(ABOVE_2_53.toString());

    const approve = await app.inject({
      method: "POST", url: `/v1/workflow/authority/limits/${id}/approve`,
      headers: { authorization: `Bearer ${token("b5000000-2222-4000-8000-000000000003")}` },
    });
    expect(approve.statusCode).toBe(202);

    const found = await waitFor(async () => {
      const g = await app.inject({
        method: "GET", url: "/v1/workflow/authority/limits",
        headers: { authorization: `Bearer ${token()}` },
      });
      const rows = g.json().data as Array<{ id: string; status: string; maxAmount: string }>;
      const row = rows.find((l) => l.id === id);
      return row && row.status === "active" ? row : null;
    });
    await app.close();
    expect(found.maxAmount).toBe(ABOVE_2_53.toString());
  });

  it("the /check endpoint accepts a string paise amount and compares it exactly", async () => {
    const app = await buildApp();
    const create = await app.inject({
      method: "POST", url: "/v1/workflow/authority/limits",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        scopeType: "role", scopeRef: "http-check-board", authorityType: "financial",
        maxAmount: ABOVE_2_53.toString(), effectiveFrom: "2025-01-01",
      },
    });
    expect(create.statusCode).toBe(202);
    const { id } = create.json();
    await waitFor(async () => {
      const g = await app.inject({
        method: "GET", url: "/v1/workflow/authority/limits",
        headers: { authorization: `Bearer ${token()}` },
      });
      const rows = g.json().data as Array<{ id: string }>;
      return rows.find((l) => l.id === id) ?? null;
    });

    const approve = await app.inject({
      method: "POST", url: `/v1/workflow/authority/limits/${id}/approve`,
      headers: { authorization: `Bearer ${token("b5000000-2222-4000-8000-000000000004")}` },
    });
    expect(approve.statusCode).toBe(202);
    await waitFor(async () => {
      const g = await app.inject({
        method: "GET", url: "/v1/workflow/authority/limits",
        headers: { authorization: `Bearer ${token()}` },
      });
      const rows = g.json().data as Array<{ id: string; status: string }>;
      const row = rows.find((l) => l.id === id);
      return row && row.status === "active" ? row : null;
    });

    const check = await app.inject({
      method: "POST", url: "/v1/workflow/authority/check",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        authorityType: "financial", amount: ABOVE_2_53.toString(),
        scopes: [{ scopeType: "role", scopeRef: "http-check-board" }],
      },
    });
    await app.close();
    expect(check.statusCode).toBe(200);
    expect(check.json().data.withinActorAuthority).toBe(true);
    expect(check.json().data.actorMax).toBe(ABOVE_2_53.toString());
  });
});
