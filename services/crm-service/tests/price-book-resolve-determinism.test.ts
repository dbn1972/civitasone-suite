/**
 * GAP-CRM-PRICE-BOOKS-03 (pin): two enabled books with identical criteria resolve
 * DETERMINISTICALLY — highest priority first, then name, then id — so a quote price can
 * never flip between calls. This pins the behaviour the gap asked about.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sqlClient } from "../src/shared/db.js";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
async function resolveId(): Promise<string | undefined> {
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/v1/crm/price-books/resolve?segment=gov",
    headers: {
      authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["crm_user"], sid: "sess-pb" }, SECRET)}`,
      "x-tenant-id": TENANT,
    },
  });
  await app.close();
  expect(res.statusCode).toBe(200);
  return (res.json().data as { id?: string } | null)?.id;
}

const TENANT = randomUUID();
const ACTOR = randomUUID();

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}
async function book(name: string, priority: number, id: string = randomUUID()): Promise<string> {
  await scoped(
    (tx) => tx`INSERT INTO crm.price_books (id, tenant_id, name, segment, currency, priority, enabled, created_by, updated_by)
      VALUES (${id}, ${TENANT}, ${name}, 'gov', 'INR', ${priority}, true, ${ACTOR}, ${ACTOR})`,
  );
  return id;
}
const clean = () => scoped((tx) => tx`DELETE FROM crm.price_books WHERE tenant_id = ${TENANT}`).catch(() => {});

beforeAll(clean);
afterAll(async () => {
  await clean();
  await sqlClient.end();
});

describe("price-book resolve precedence", () => {
  it("higher priority wins between identical-criteria books", async () => {
    await book("Standard", 1);
    const hi = await book("Festival", 5);
    expect((await resolveId())).toBe(hi);
  });

  it("equal priority falls back to name ASC, then id ASC, and is stable across calls", async () => {
    await clean();
    const idB = "00000000-0000-4000-8000-00000000000b";
    const idA = "00000000-0000-4000-8000-00000000000a";
    await book("Same Name", 3, idB);
    await book("Same Name", 3, idA);
    expect(await resolveId()).toBe(idA);
    for (let i = 0; i < 3; i++) expect((await resolveId())).toBe(idA);
  });
});
