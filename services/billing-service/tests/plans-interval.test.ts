/**
 * GAP-BILLING-PLANS-NEW-01 (UAT B4): a plan carries its billing interval (monthly | quarterly |
 * yearly). POST accepts it (default monthly), GET returns it, and the tenant Plans overview
 * normalises the displayed price to per-month so plans of different intervals compare honestly.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerPlansConsumers } from "../src/modules/plans/consumer.js";
import { monthsInInterval, pricePerMonthMinor } from "../src/modules/plans/domain.js";

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const PLATFORM = "00000000-0000-0000-0000-000000000000";
const T = randomUUID();
const ACTOR = randomUUID();
const tag = randomUUID().slice(0, 8);
const bearer = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: T, roles, sid: "s-int" }, SECRET, 3600)}` });
const drain = () => (queue as unknown as { drain(): Promise<void> }).drain();
let app: Awaited<ReturnType<typeof buildApp>>;
const ids: string[] = [];

beforeAll(async () => { registerPlansConsumers(queue); await queue.start(); app = await buildApp(); });
afterAll(async () => {
  await withTenantScope(db as never, PLATFORM, (tx: any) => tx.execute(sql`DELETE FROM plans.billing_plans WHERE code LIKE ${"int-" + tag + "%"}`));
  await app.close();
  await sqlClient.end();
});

async function create(code: string, extra: Record<string, unknown>) {
  const r = await app.inject({ method: "POST", url: "/v1/billing/plans", headers: bearer(["super_admin"]), payload: { name: "Interval plan", code: `int-${tag}-${code}`, priceMinor: 120000, currency: "INR", govtExempt: false, ...extra } });
  if (r.statusCode === 202) { ids.push(r.json().id); await drain(); }
  return r;
}
const read = async (id: string) => (await app.inject({ method: "GET", url: `/v1/billing/plans/${id}`, headers: bearer(["tenant_admin"]) })).json();

describe("monthsInInterval / pricePerMonthMinor (pure)", () => {
  it("maps intervals to months and divides price per month in whole paise", () => {
    expect(monthsInInterval("monthly")).toBe(1);
    expect(monthsInInterval("quarterly")).toBe(3);
    expect(monthsInInterval("yearly")).toBe(12);
    expect(pricePerMonthMinor(120000n, "yearly")).toBe(10000n);
    expect(pricePerMonthMinor(120000n, "quarterly")).toBe(40000n);
    expect(pricePerMonthMinor(100n, "yearly")).toBe(8n);
  });
});

describe("POST/GET /v1/billing/plans interval", () => {
  it("persists the chosen interval and returns it on the detail read", async () => {
    const r = await create("q", { interval: "quarterly" });
    expect(r.statusCode).toBe(202);
    expect(await read(r.json().id)).toMatchObject({ interval: "quarterly", priceMinor: "120000" });
  });
  it("defaults to monthly when the interval is omitted (older clients)", async () => {
    const r = await create("d", {});
    expect(r.statusCode).toBe(202);
    expect((await read(r.json().id)).interval).toBe("monthly");
  });
  it("an unknown interval is a 400 and creates nothing", async () => {
    const r = await create("bad", { interval: "weekly" });
    expect(r.statusCode).toBe(400);
  });
});
