/**
 * Per-USER gateway rate limit (replaces the single shared per-tenant 200/min bucket).
 *
 * Before: every user of a tenant drew from one 200/min bucket, so a handful of
 * concurrent users (each page fires ~4 calls) produced 429s for everyone.
 * Now the bucket is the verified token subject; the per-tenant limit remains
 * only as a higher safety ceiling, and unauthenticated traffic is keyed by IP.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomInt, randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp, envPositiveInt } from "../src/app.js";

const SECRET = "test_secret_for_civitasone_32chr";
const ENV_KEYS = [
  "GATEWAY_RATE_LIMIT_MAX",
  "GATEWAY_RATE_LIMIT_USER_MAX",
  "GATEWAY_RATE_LIMIT_USER_WINDOW",
  "GATEWAY_RATE_LIMIT_TENANT_MAX",
  "GATEWAY_RATE_LIMIT_TENANT_WINDOW",
];
// Unique ids per test: with REDIS_URL set the buckets outlive the app.
let TENANT = "";
let IP = "";
const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

async function newApp() {
  const app = await buildApp();
  apps.push(app);
  return app;
}
function tokenFor(sub: string, tid = TENANT) {
  return signToken({ sub, tid, roles: ["finance_officer"] }, SECRET, 3600);
}
async function hit(
  app: Awaited<ReturnType<typeof buildApp>>,
  opts: { token?: string; ip?: string } = {},
) {
  return app.inject({
    method: "GET",
    url: "/api/v1/finance/bills",
    headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {},
    remoteAddress: opts.ip ?? IP,
  });
}
async function codes(
  app: Awaited<ReturnType<typeof buildApp>>,
  n: number,
  opts: { token?: string; ip?: string } = {},
) {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((await hit(app, opts)).statusCode);
  return out;
}

beforeEach(() => {
  TENANT = randomUUID();
  IP = `10.${randomInt(256)}.${randomInt(256)}.${1 + randomInt(254)}`;
  process.env.GATEWAY_RATE_LIMIT_MAX = "1000000"; // keep the global IP tier out of the way
  process.env.GATEWAY_RATE_LIMIT_TENANT_MAX = "1000000";
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("per-user gateway rate limit", () => {
  it("two users in the SAME tenant get independent buckets", async () => {
    process.env.GATEWAY_RATE_LIMIT_USER_MAX = "3";
    const app = await newApp();
    const alice = tokenFor("alice");
    const bob = tokenFor("bob");

    expect(await codes(app, 4, { token: alice })).toEqual([200, 200, 200, 429]);
    // Alice exhausting her budget must not touch Bob's.
    expect(await codes(app, 4, { token: bob })).toEqual([200, 200, 200, 429]);
  });

  it("a busy user no longer starves a colleague (the 4-calls-per-page scenario)", async () => {
    process.env.GATEWAY_RATE_LIMIT_USER_MAX = "20";
    const app = await newApp();
    const busy = await codes(app, 25, { token: tokenFor("busy") });
    expect(busy.filter((c) => c === 429).length).toBe(5);
    expect(await codes(app, 20, { token: tokenFor("quiet") })).toEqual(Array(20).fill(200));
  });

  it("the per-tenant ceiling still caps the SUM of all users in the tenant", async () => {
    process.env.GATEWAY_RATE_LIMIT_USER_MAX = "100";
    process.env.GATEWAY_RATE_LIMIT_TENANT_MAX = "4";
    const app = await newApp();
    const a = await codes(app, 2, { token: tokenFor("u1") });
    const b = await codes(app, 3, { token: tokenFor("u2") });
    expect([...a, ...b]).toEqual([200, 200, 200, 200, 429]);
  });

  it("the same subject in a different tenant has its own bucket", async () => {
    process.env.GATEWAY_RATE_LIMIT_USER_MAX = "2";
    const app = await newApp();
    const other = randomUUID();
    expect(await codes(app, 3, { token: tokenFor("same-sub") })).toEqual([200, 200, 429]);
    expect(await codes(app, 2, { token: tokenFor("same-sub", other) })).toEqual([200, 200]);
  });

  it("an unauthenticated flood from one IP is still limited, and other IPs are unaffected", async () => {
    process.env.GATEWAY_RATE_LIMIT_USER_MAX = "3";
    const app = await newApp();
    const FORM_KEY = "c".repeat(64);
    const pub = async (ip: string) =>
      (
        await app.inject({
          method: "POST",
          url: `/api/v1/crm/public/leads/${FORM_KEY}`,
          payload: { name: "Prospect", consent: true },
          remoteAddress: ip,
        })
      ).statusCode;
    const flood: number[] = [];
    for (let i = 0; i < 5; i++) flood.push(await pub(IP));
    expect(flood).toEqual([200, 200, 200, 429, 429]);
    expect(await pub(`10.${randomInt(256)}.${randomInt(256)}.${1 + randomInt(254)}`)).toBe(200);
  });

  it("honours the configured limit and returns 429 with the standard x-ratelimit-* headers", async () => {
    process.env.GATEWAY_RATE_LIMIT_USER_MAX = "5";
    const app = await newApp();
    const token = tokenFor("hdr");
    const first = await hit(app, { token });
    expect(first.statusCode).toBe(200);
    expect(first.headers["x-ratelimit-limit"]).toBe("5");
    expect(first.headers["x-ratelimit-remaining"]).toBe("4");

    await codes(app, 4, { token }); // 5 total
    const limited = await hit(app, { token });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["x-ratelimit-limit"]).toBe("5");
    expect(limited.headers["x-ratelimit-remaining"]).toBe("0");
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(limited.headers["x-ratelimit-reset"]).toBeDefined();
  });

  it("honours the configured window", async () => {
    process.env.GATEWAY_RATE_LIMIT_USER_MAX = "1";
    process.env.GATEWAY_RATE_LIMIT_USER_WINDOW = "20 second";
    const app = await newApp();
    const token = tokenFor("win");
    await hit(app, { token });
    const limited = await hit(app, { token });
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeLessThanOrEqual(20);
  });

  it("defaults to 200 per user per minute when unset", async () => {
    const app = await newApp();
    const res = await hit(app, { token: tokenFor("dflt") });
    expect(res.headers["x-ratelimit-limit"]).toBe("200");
  });

  it("envPositiveInt falls back to the default on garbage, zero or negative values (a typo must not disable the limiter)", () => {
    process.env.GATEWAY_RATE_LIMIT_USER_MAX = "abc";
    expect(envPositiveInt("GATEWAY_RATE_LIMIT_USER_MAX", 200)).toBe(200);
    process.env.GATEWAY_RATE_LIMIT_USER_MAX = "0";
    expect(envPositiveInt("GATEWAY_RATE_LIMIT_USER_MAX", 200)).toBe(200);
    process.env.GATEWAY_RATE_LIMIT_USER_MAX = "-5";
    expect(envPositiveInt("GATEWAY_RATE_LIMIT_USER_MAX", 200)).toBe(200);
    process.env.GATEWAY_RATE_LIMIT_USER_MAX = "7.9";
    expect(envPositiveInt("GATEWAY_RATE_LIMIT_USER_MAX", 200)).toBe(7);
  });
});
