/**
 * Owner decision (W8-D follow-up): POST /v1/revenue/trade-licenses/:id/renew must KEEP the
 * licence's current fee when feeMinor is omitted. The renew body used to default feeMinor to
 * '0', so every renewal that did not restate the fee zeroed it (revenue loss). An explicit
 * feeMinor still applies, including an explicit 0 (fee waiver on renewal).
 *
 * Real DB, end to end: the route's published command is fed to the real renew consumer
 * (MemoryQueue, tenant context), then the stored licence is read back.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { tenantTransaction, withTenantConsumer } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { MemoryQueue, type Handler } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { tradeLicenses } from "../src/modules/trade-license/schema.js";
import { registerTradeLicenseConsumers } from "../src/modules/trade-license/consumer.js";
import { renewTradeLicenseBody, createTradeLicenseBody } from "../src/modules/trade-license/validators.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const OLD_FEE = 250000n;
const ids: string[] = [];
const bearer = () => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["revenue_admin"], sid: "sess-renew-fee" }, SECRET, 3600)}`,
});

let app: FastifyInstance;
let worker: MemoryQueue;

async function seedLicense(): Promise<string> {
  const id = randomUUID();
  ids.push(id);
  await tenantTransaction(db, TENANT, (tx) => (tx as typeof db).insert(tradeLicenses).values({
    id, tenantId: TENANT, licenseNo: `FEE${id.slice(0, 8)}`, businessName: "Fee shop", proprietorName: "Fee",
    address: "1 Test Road", businessType: "retail", expiryDate: "2027-03-31", feeMinor: OLD_FEE, createdBy: ACTOR, updatedBy: ACTOR,
  }));
  return id;
}
async function readLicense(id: string) {
  const rows = await tenantTransaction(db, TENANT, (tx) =>
    (tx as typeof db).select().from(tradeLicenses).where(and(eq(tradeLicenses.tenantId, TENANT), eq(tradeLicenses.id, id))));
  return rows[0]!;
}
/** POST renew through the real route, then run the published command through the real consumer. */
async function renew(id: string, payload: Record<string, unknown>) {
  const publish = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
  const res = await app.inject({ method: "POST", url: `/v1/revenue/trade-licenses/${id}/renew`, headers: bearer(), payload });
  expect(res.statusCode).toBe(202);
  expect(publish).toHaveBeenCalledTimes(1);
  const [topic, msg] = publish.mock.calls[0]! as [string, Parameters<MemoryQueue["publish"]>[1]];
  publish.mockRestore();
  await worker.publish(topic, msg);
  await worker.drain();
  return msg as unknown as { payload: Record<string, unknown> };
}

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  worker = new MemoryQueue();
  const raw = worker.subscribe.bind(worker);
  worker.subscribe = ((topic: string, h: Handler) => raw(topic, withTenantConsumer(h) as Handler)) as typeof worker.subscribe;
  registerTradeLicenseConsumers(worker);
  await worker.start();
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => {
  if (ids.length) {
    await tenantTransaction(db, TENANT, (tx) =>
      (tx as typeof db).delete(tradeLicenses).where(and(eq(tradeLicenses.tenantId, TENANT), inArray(tradeLicenses.id, ids)))).catch(() => undefined);
  }
  await app.close();
  await sqlClient.end();
});

describe("renew body: feeMinor is optional with no default", () => {
  it("an omitted feeMinor stays absent (the consumer keeps the stored fee)", () => {
    expect(renewTradeLicenseBody.parse({ renewalYear: 2028 }).feeMinor).toBeUndefined();
  });
  it("an explicit feeMinor (number or digit string, including 0) is kept", () => {
    expect(renewTradeLicenseBody.parse({ renewalYear: 2028, feeMinor: 300000 }).feeMinor).toBe("300000");
    expect(renewTradeLicenseBody.parse({ renewalYear: 2028, feeMinor: "0" }).feeMinor).toBe("0");
    expect(renewTradeLicenseBody.parse({ renewalYear: 2028, feeMinor: 0 }).feeMinor).toBe("0");
  });
  it("a negative or non-numeric feeMinor is still refused", () => {
    expect(() => renewTradeLicenseBody.parse({ renewalYear: 2028, feeMinor: -1 })).toThrow();
    expect(() => renewTradeLicenseBody.parse({ renewalYear: 2028, feeMinor: "12.5" })).toThrow();
  });
  it("create is unchanged: an omitted feeMinor still starts the licence at 0", () => {
    const body = createTradeLicenseBody.parse({ businessName: "x", address: "y", businessType: "retail" });
    expect(body.feeMinor).toBe("0");
  });
});

describe("POST /v1/revenue/trade-licenses/:id/renew keeps the fee unless one is supplied (real DB)", () => {
  it("renew without feeMinor keeps the licence's previous fee", async () => {
    const id = await seedLicense();
    const msg = await renew(id, { renewalYear: 2028 });
    expect(msg.payload).not.toHaveProperty("feeMinor");
    const row = await readLicense(id);
    expect(row.feeMinor).toBe(OLD_FEE);
    expect(row.expiryDate).toBe("2028-03-31");
    expect(row.renewalCount).toBe(1);
  });

  it("renew with feeMinor updates the fee", async () => {
    const id = await seedLicense();
    await renew(id, { expiryDate: "2028-06-30", feeMinor: 300000 });
    const row = await readLicense(id);
    expect(row.feeMinor).toBe(300000n);
    expect(row.expiryDate).toBe("2028-06-30");
  });

  it("an explicit feeMinor of 0 is honoured (fee waiver on renewal)", async () => {
    const id = await seedLicense();
    await renew(id, { renewalYear: 2028, feeMinor: 0 });
    expect((await readLicense(id)).feeMinor).toBe(0n);
  });
});
