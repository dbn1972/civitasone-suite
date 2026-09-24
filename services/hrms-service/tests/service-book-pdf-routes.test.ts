/**
 * Service-book PDF export route tests.
 *
 * SEC-CRIT-001: entry fields (description, documentRef, entryType,
 * effectiveDate) were interpolated into the exported HTML via plain string
 * interpolation with no escaping -- a stored-XSS entry ended up as live
 * markup in the generated PDF/HTML. Every interpolated value must now be
 * HTML-escaped.
 *
 * GET /v1/hrms/employees/:id/service-book/pdf
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createMockSqlClient } from "./fixtures/mock-sql-client.js";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER   = "aaaaaaaa-1111-4000-8000-000000000001";
const EMP_ID = "eeeeeeee-1111-4000-8000-000000000001";

const { listEntriesMock } = vi.hoisted(() => ({
  listEntriesMock: vi.fn(),
}));

vi.mock("../src/modules/service-book/repo.js", () => ({
  listServiceBookEntries: (...a: unknown[]) => listEntriesMock(...a),
  insertServiceBookEntry: async () => {},
  getEntry:               async () => undefined,
  attestEntry:             async () => null,
}));

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}),
    execute: async () => [],
  },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  sqlClient: createMockSqlClient(),
  sqlPool: { query: async () => ({ rows: [], rowCount: 0 }) },
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: async () => {},
    makeKey: (...a: string[]) => a.join(":"),
    getOrLoad: async (_k: string, fn: () => Promise<unknown>) => fn(),
    listKey: (...a: string[]) => a.join(":"),
    listOrLoad: async (_t: string, _ns: string, _k: string, fn: () => Promise<unknown>) => fn(),
  },
  queue: { publish: async () => {} },
}));

import { buildApp } from "../src/app.js";

const tok = (sub = USER, roles = ["hr_admin"]) =>
  signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["hr_admin"]) =>
  ({ authorization: `Bearer ${tok(sub, roles)}` });

const BASE_ENTRY = {
  id: "ffffffff-1111-4000-8000-000000000001",
  tenantId: TENANT,
  employeeId: EMP_ID,
  entryType: "promotion",
  effectiveDate: "2026-01-01",
  description: "Promoted to Senior Engineer",
  documentRef: "DOC-001",
  attested: false,
  attestedBy: null,
  attestedAt: null,
  attestRemarks: null,
  createdAt: new Date("2026-01-02"),
};

beforeEach(() => {
  vi.clearAllMocks();
  listEntriesMock.mockResolvedValue([]);
});

afterAll(async () => {
  const { sqlClient } = await import("../src/shared/db.js");
  await sqlClient.end();
});

describe("GET /v1/hrms/employees/:id/service-book/pdf", () => {
  it("200 — escapes a hostile description (no live <script> tag in the output)", async () => {
    listEntriesMock.mockResolvedValue([
      { ...BASE_ENTRY, description: "<script>alert(1)</script>" },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/employees/${EMP_ID}/service-book/pdf`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(r.body).not.toContain("<script>alert(1)</script>");
    await app.close();
  });

  it("200 — escapes a hostile documentRef", async () => {
    listEntriesMock.mockResolvedValue([
      { ...BASE_ENTRY, documentRef: '"><img src=x onerror=alert(1)>' },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/employees/${EMP_ID}/service-book/pdf`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain("<img src=x");
    expect(r.body).toContain("&lt;img src=x");
    await app.close();
  });

  it("200 — escapes a hostile entryType", async () => {
    listEntriesMock.mockResolvedValue([
      { ...BASE_ENTRY, entryType: "<b>promotion</b>" },
    ]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/employees/${EMP_ID}/service-book/pdf`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain("<b>promotion</b>");
    expect(r.body).toContain("&lt;b&gt;promotion&lt;/b&gt;");
    await app.close();
  });

  it("200 — renders a clean entry's fields unchanged", async () => {
    listEntriesMock.mockResolvedValue([BASE_ENTRY]);
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/employees/${EMP_ID}/service-book/pdf`,
      headers: auth(),
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Promoted to Senior Engineer");
    expect(r.body).toContain("DOC-001");
    await app.close();
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/employees/${EMP_ID}/service-book/pdf`,
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — employee role is rejected", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/employees/${EMP_ID}/service-book/pdf`,
      headers: auth(USER, ["employee"]),
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
