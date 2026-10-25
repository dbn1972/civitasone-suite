/**
 * CLOS3-S4-11: assertProductsSelectable must use one batched query, not one per line item.
 * DB-backed (disposable Postgres, non-superuser role); scopedRead is wrapped only to count calls.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";

const H = vi.hoisted(() => ({ reads: 0 }));
vi.mock("../src/shared/db.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/shared/db.js")>();
  return {
    ...real,
    scopedRead: ((fn: never) => { H.reads += 1; return real.scopedRead(fn); }) as typeof real.scopedRead,
  };
});

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import * as productRepo from "../src/modules/products/repo.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();

const headers = () => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["crm_admin"], sid: "s-s4-11" }, SECRET)}`,
  "x-tenant-id": TENANT,
});

function scoped<T>(tenant: string, fn: (tx: Parameters<Parameters<typeof sqlClient.begin>[0]>[0]) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenant}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function mkProduct(tenant: string, extra: { enabled?: boolean; activeTo?: string; activeFrom?: string } = {}): Promise<string> {
  const id = randomUUID();
  await scoped(tenant, (tx) => tx`
    INSERT INTO crm.products (id, tenant_id, code, name, enabled, active_from, active_to, created_by, updated_by)
    VALUES (${id}, ${tenant}, ${"S4-11-" + id.slice(0, 8)}, 'p', ${extra.enabled ?? true},
            ${extra.activeFrom ?? null}, ${extra.activeTo ?? null}, ${ACTOR}, ${ACTOR})`);
  return id;
}

const line = (productId?: string) => ({
  ...(productId ? { productId } : {}),
  description: "x", quantity: 1, unitPriceMinor: "100",
});

async function postQuote(items: ReturnType<typeof line>[]) {
  const app = await buildApp();
  H.reads = 0;
  const res = await app.inject({
    method: "POST", url: "/v1/crm/quotations", headers: headers(),
    payload: { quoteRef: "Q-" + randomUUID().slice(0, 8), templateRef: "T1", currency: "INR", lineItems: items },
  });
  const reads = H.reads;
  await app.close();
  return { res, reads };
}

async function cleanup() {
  for (const t of [TENANT, OTHER]) {
    await scoped(t, (tx) => tx`DELETE FROM crm.products WHERE tenant_id = ${t}`).catch(() => {});
  }
}

beforeAll(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("CLOS3-S4-11 batched selectability check", () => {
  it("issues the same number of reads for 1 and 8 product lines", async () => {
    const one = [await mkProduct(TENANT)];
    const many = await Promise.all(Array.from({ length: 8 }, () => mkProduct(TENANT)));
    const a = await postQuote(one.map(line));
    const b = await postQuote(many.map(line));
    expect(a.res.statusCode).toBe(202);
    expect(b.res.statusCode).toBe(202);
    expect(b.reads).toBe(a.reads);
  });

  it("rejects the FIRST non-selectable line (in request order) with the same 422 contract", async () => {
    const ok = await mkProduct(TENANT);
    const disabled = await mkProduct(TENANT, { enabled: false });
    const expired = await mkProduct(TENANT, { activeTo: "2000-01-01" });
    const { res } = await postQuote([line(ok), line(expired), line(disabled)]);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("PRODUCT_NOT_SELECTABLE");
    expect(res.json().message).toContain(expired);
    const second = await postQuote([line(ok), line(disabled), line(expired)]);
    expect(second.res.json().message).toContain(disabled);
  });

  it("treats an unknown product and another tenant's product as not selectable; non-product lines pass", async () => {
    const foreign = await mkProduct(OTHER);
    const { res } = await postQuote([line(), line(foreign)]);
    expect(res.statusCode).toBe(422);
    expect(res.json().message).toContain(foreign);
    const unknown = await postQuote([line(randomUUID())]);
    expect(unknown.res.statusCode).toBe(422);
    const plain = await postQuote([line()]);
    expect(plain.res.statusCode).toBe(202);
  });

  it("selectableByIds returns exactly the selectable, de-duplicated ids", async () => {
    const ok = await mkProduct(TENANT);
    const future = await mkProduct(TENANT, { activeFrom: "2999-01-01" });
    const set = await runWithTenant(TENANT, () => productRepo.selectableByIds(TENANT, [ok, ok, future, randomUUID()]));
    expect([...set]).toEqual([ok]);
    expect((await runWithTenant(TENANT, () => productRepo.selectableByIds(TENANT, []))).size).toBe(0);
  });
});
