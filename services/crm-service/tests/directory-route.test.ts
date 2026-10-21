/**
 * GET /v1/crm/directory/users - the route's own guarantees, with the user-directory module stubbed so the
 * route code is what is under test (not identity-service, not the module's own id+name mapping):
 *
 *  - the response is PROJECTED to { id, name } by the route, even if the directory layer returned more
 *    (email, phone, roles...): remove the projection in directory/routes.ts and these tests fail;
 *  - a control character in ?q= is a 400 and never reaches identity (it used to surface as a 503);
 *  - the name search has its own, larger rate-limit bucket, independent of the plain picker load.
 *
 * Needs the disposable Postgres like every crm-service suite (the app is built for real).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

vi.mock("../src/shared/user-directory.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/shared/user-directory.js")>()),
  listDirectoryUsers: vi.fn(),
  searchDirectoryUsers: vi.fn(),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { listDirectoryUsers, searchDirectoryUsers } from "../src/shared/user-directory.js";
import { DIRECTORY_BROWSE_LIMIT_PER_MINUTE, DIRECTORY_SEARCH_LIMIT_PER_MINUTE } from "../src/modules/directory/routes.js";

const SECRET = process.env.JWT_SECRET as string; // set by vitest.config.ts
const TENANT = randomUUID();
const ACTOR = randomUUID();
const PERSON = randomUUID();

function headers(roles = ["crm_user"]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

/** What a careless directory layer might hand the route: far more than id + name. */
const LEAKY = [
  {
    id: PERSON,
    name: "Asha Rao",
    email: "asha.rao@example.gov.in",
    phone: "+919876500001",
    roles: ["tenant_admin"],
    status: "active",
    mfaEnabled: true,
    empCode: "E-1001",
  },
];

const app = await buildApp();

beforeEach(() => {
  vi.mocked(listDirectoryUsers).mockReset().mockResolvedValue({ users: LEAKY as never, truncated: false });
  vi.mocked(searchDirectoryUsers).mockReset().mockResolvedValue({ users: LEAKY as never, truncated: false });
});
afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

function get(url: string, opts: { roles?: string[]; ip?: string } = {}) {
  return app.inject({ method: "GET", url, headers: headers(opts.roles), ...(opts.ip ? { remoteAddress: opts.ip } : {}) });
}

const LEAKED = ["asha.rao@example.gov.in", "+919876500001", "9876500001", "tenant_admin", "mfaEnabled", "E-1001", "status", "active"];

describe("the route projects every person to exactly { id, name }", () => {
  it.each([["crm_user"], ["crm_admin"], ["tenant_admin"], ["super_admin"]])("plain list, as %s", async (role) => {
    const res = await get("/v1/crm/directory/users", { roles: [role] });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([{ id: PERSON, name: "Asha Rao" }]);
    expect(Object.keys(res.json().data[0]).sort()).toEqual(["id", "name"]);
    for (const leaked of LEAKED) expect(res.body).not.toContain(leaked);
  });

  it.each([["crm_user"], ["crm_admin"]])("name search, as %s", async (role) => {
    const res = await get("/v1/crm/directory/users?q=asha", { roles: [role] });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([{ id: PERSON, name: "Asha Rao" }]);
    expect(Object.keys(res.json().data[0]).sort()).toEqual(["id", "name"]);
    for (const leaked of LEAKED) expect(res.body).not.toContain(leaked);
    expect(searchDirectoryUsers).toHaveBeenCalledWith(TENANT, "asha");
  });
});

describe("?q= refuses control characters with a 400 before identity is asked", () => {
  it.each([
    ["a NUL in the middle", "ab%00cd"],
    ["a unit separator", "ab%1fcd"],
    ["DEL", "ab%7fcd"],
    ["a tab in the middle", "ab%09cd"],
    ["a newline in the middle", "ab%0acd"],
    ["a trailing NUL", "abcd%00"],
  ])("%s", async (_label, q) => {
    const res = await get(`/v1/crm/directory/users?q=${q}`);
    expect(res.statusCode).toBe(400);
    expect(searchDirectoryUsers).not.toHaveBeenCalled();
    expect(listDirectoryUsers).not.toHaveBeenCalled();
  });

  it("still 400s a too-short query, and still accepts an ordinary name with a space, hyphen or apostrophe", async () => {
    expect((await get("/v1/crm/directory/users?q=a")).statusCode).toBe(400);
    for (const q of ["Asha%20Rao", "Rao-Iyer", "D%27Souza"]) {
      expect((await get(`/v1/crm/directory/users?q=${q}`)).statusCode, q).toBe(200);
    }
  });

  it("answers 503 (not 400) only when identity genuinely cannot be read for a valid query", async () => {
    vi.mocked(searchDirectoryUsers).mockResolvedValue(undefined);
    expect((await get("/v1/crm/directory/users?q=asha")).statusCode).toBe(503);
  });
});

describe("rate limiting: the name search has its own, larger budget (per tenant + IP)", () => {
  // 127.0.0.1 is on the limiter allow-list, so every case uses its own address. The limiter window
  // starts at the first request of a key, so there is no minute boundary to straddle.
  it("browse budget is the conservative 60/min; search is 240/min and stays below the 300/min service default", () => {
    expect(DIRECTORY_BROWSE_LIMIT_PER_MINUTE).toBe(60);
    expect(DIRECTORY_SEARCH_LIMIT_PER_MINUTE).toBe(240);
    expect(DIRECTORY_SEARCH_LIMIT_PER_MINUTE).toBeLessThan(300);
  });

  it("the plain list is limited at 60/min, and the 61st request is a 429", async () => {
    const ip = "10.20.30.1";
    for (let i = 0; i < DIRECTORY_BROWSE_LIMIT_PER_MINUTE; i += 1) {
      expect((await get("/v1/crm/directory/users", { ip })).statusCode, `request ${i + 1}`).toBe(200);
    }
    expect((await get("/v1/crm/directory/users", { ip })).statusCode).toBe(429);
  });

  it("an exhausted browse budget does not block the search from the same address, and another address is unaffected", async () => {
    const ip = "10.20.30.2";
    for (let i = 0; i < DIRECTORY_BROWSE_LIMIT_PER_MINUTE; i += 1) await get("/v1/crm/directory/users", { ip });
    expect((await get("/v1/crm/directory/users", { ip })).statusCode).toBe(429);
    expect((await get("/v1/crm/directory/users?q=asha", { ip })).statusCode).toBe(200);
    expect((await get("/v1/crm/directory/users", { ip: "10.20.30.99" })).statusCode).toBe(200);
  });

  it("the search is limited at 240/min, and the 241st request is a 429; the plain list from that address is still open", async () => {
    const ip = "10.20.30.3";
    for (let i = 0; i < DIRECTORY_SEARCH_LIMIT_PER_MINUTE; i += 1) {
      const res = await get("/v1/crm/directory/users?q=asha", { ip });
      if (res.statusCode !== 200) throw new Error(`search ${i + 1} answered ${res.statusCode}`);
    }
    expect((await get("/v1/crm/directory/users?q=asha", { ip })).statusCode).toBe(429);
    expect((await get("/v1/crm/directory/users", { ip })).statusCode).toBe(200);
  });
});
