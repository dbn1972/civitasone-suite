/**
 * listByTenant free-text search must not probe raw attribute text for callers
 * without cleartext-PII access (row-count oracle for email/phone/PAN/Aadhaar).
 */
import { describe, it, expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const H = vi.hoisted(() => ({ wheres: [] as unknown[] }));

vi.mock("../src/shared/db.js", () => {
  const chain = (): any => {
    const c: any = {
      from: () => c,
      where: (w: unknown) => { H.wheres.push(w); return c; },
      orderBy: () => c,
      limit: () => c,
      offset: () => Promise.resolve([]),
      then: (res: (v: unknown) => unknown) => Promise.resolve([{ count: 0 }]).then(res),
    };
    return c;
  };
  return {
    db: {},
    scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn({ select: () => chain() }),
  };
});

import { listByTenant } from "../src/modules/profiles/repo.js";

const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const render = (w: unknown) => new PgDialect().sqlToQuery(w as never);

async function whereFor(search: string, restrictPii?: boolean) {
  H.wheres.length = 0;
  await listByTenant(TENANT, 10, 0, { search, ...(restrictPii !== undefined ? { restrictPii } : {}) });
  return render(H.wheres[0]);
}

describe("profiles repo search PII restriction", () => {
  it("unrestricted (admin) search keeps the raw attributes::text scan", async () => {
    const q = await whereFor("raj", false);
    expect(q.sql).toContain("::text ILIKE");
  });

  it("restricted search never scans the raw attribute text", async () => {
    const q = await whereFor("raj", true);
    expect(q.sql).not.toContain("::text ILIKE");
    expect(q.sql).toContain("jsonb_each_text");
    expect(q.params).toEqual(expect.arrayContaining(["name", "%raj%"]));
    expect(q.params).not.toContain("email");
  });

  it.each(["raj@example.com", "9876543210", "ABCDE1234F", "1234 5678 9012"])("restricted PII-shaped query %s matches nothing", async (s) => {
    const q = await whereFor(s, true);
    expect(q.sql).toContain("false");
    expect(q.params).not.toContain(`%${s}%`);
  });
});
