/**
 * w0-report.md: vendor registration silently dropped category, contactPerson,
 * address and the bank account number (zod stripped the keys the web form
 * sent, and three of them had no column). Pins:
 *   1. createVendorBody keeps all four fields;
 *   2. the vendorCreate consumer persists all four (real DB, RLS role);
 *   3. read responses (list + detail) never return the full account number;
 *   4. the keys the web RegisterVendorForm POSTs are all known to the API
 *      schema, so the two cannot drift apart again.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
process.env.PII_ENC_KEY = process.env.PII_ENC_KEY ?? "test_pii_encryption_key_32chars!!";
import { MemoryQueue } from "@civitasone/queue";
import type { Queue, Handler } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { eq, sql } from "drizzle-orm";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { procurementVendors } from "../src/modules/vendor/schema.js";
import { registerVendorConsumers } from "../src/modules/vendor/consumer.js";
import { createVendorBody } from "../src/modules/vendor/validators.js";
import { maskAccountNumber } from "../src/modules/vendor/queries.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "11111111-eeee-4000-8000-0000000000b1";
const ACTOR = randomUUID();
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const ACCOUNT = "123456789012";

// What the web form posts for a fully filled-in registration.
const FORM_BODY = {
  name: "Fields Test Traders",
  category: "goods",
  contactPerson: "Asha Verma",
  address: "12 Sector 5, New Delhi 110001",
  ifsc: "SBIN0001234",
  bankAccount: ACCOUNT,
};

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

let queue: Queue;
async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => { await tx.delete(procurementVendors).where(eq(procurementVendors.tenantId, TENANT)); }),
  );
}

beforeAll(async () => {
  queue = wireTenantAwareQueue(new MemoryQueue() as unknown as Queue);
  registerVendorConsumers(queue);
  await queue.start();
  await clean();
});
afterAll(async () => { await clean(); await queue.stop(); await sqlClient.end(); });

describe("createVendorBody keeps the registration fields", () => {
  it("does not strip category, contactPerson, address or bankAccount", () => {
    const parsed = createVendorBody.parse(FORM_BODY);
    expect(parsed).toMatchObject({
      category: "goods", contactPerson: "Asha Verma",
      address: "12 Sector 5, New Delhi 110001", bankAccount: ACCOUNT,
    });
  });
  it("rejects an unknown category", () => {
    expect(createVendorBody.safeParse({ ...FORM_BODY, category: "bogus" }).success).toBe(false);
  });
});

describe("vendorCreate persists all four fields and reads mask the account", () => {
  const id = randomUUID();

  it("stores category, contact person, address and bank account", async () => {
    const parsed = createVendorBody.parse(FORM_BODY);
    await runWithTenant(TENANT, () =>
      queue.publish(COMMANDS.vendorCreate, {
        messageId: randomUUID(), type: COMMANDS.vendorCreate,
        tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
        payload: { id, tenantId: TENANT, ...parsed },
      }),
    );
    await queue.drain();
    const [row] = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.select().from(procurementVendors).where(eq(procurementVendors.id, id))),
    );
    expect(row.category).toBe("goods");
    expect(row.contactPerson).toBe("Asha Verma");
    expect(row.address).toBe("12 Sector 5, New Delhi 110001");
    expect(row.bankAccount).toBe(ACCOUNT);
    expect(row.ifsc).toBe("SBIN0001234");
  });

  it("encrypts contact person and address at rest", async () => {
    const rows = await runWithTenant(TENANT, () =>
      db.transaction((tx) => tx.execute(
        sql`SELECT contact_person, address, bank_account FROM vendor.procurement_vendors WHERE id = ${id}`)),
    );
    const r = (rows as unknown as Array<Record<string, string>>)[0];
    expect(r.contact_person).toMatch(/^enc:v/);
    expect(r.address).toMatch(/^enc:v/);
    expect(r.bank_account).toMatch(/^enc:v/);
  });

  it("GET list and GET detail return the account number masked, never in full", async () => {
    const app = await buildApp();
    const headers = { authorization: `Bearer ${signToken({ sub: "u-w0", tid: TENANT, roles: ["procurement_officer"], sid: "s-w0" }, SECRET)}` };
    const list = await app.inject({ method: "GET", url: "/v1/procurement/vendors", headers });
    const detail = await app.inject({ method: "GET", url: `/v1/procurement/vendors/${id}`, headers });
    await app.close();

    expect(list.statusCode).toBe(200);
    const listed = list.json().data.find((v: { id: string }) => v.id === id);
    expect(listed.bankAccount).toBe("********9012");
    expect(listed.category).toBe("goods");
    expect(listed.contactPerson).toBe("Asha Verma");
    expect(JSON.stringify(list.json())).not.toContain(ACCOUNT);

    expect(detail.statusCode).toBe(200);
    expect(detail.json().data.bankAccount).toBe("********9012");
    expect(detail.json().data.category).toBe("goods");
    expect(JSON.stringify(detail.json())).not.toContain(ACCOUNT);
  });
});

describe("maskAccountNumber", () => {
  it("keeps only the last four characters", () => {
    expect(maskAccountNumber("123456789012")).toBe("********9012");
    expect(maskAccountNumber("1234")).toBe("1234");
  });
  it("masks a number shorter than four in full", () => {
    expect(maskAccountNumber("12")).toBe("****");
  });
});

describe("web form body and API schema stay in sync", () => {
  it("every key RegisterVendorForm POSTs is a key createVendorBody accepts", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../apps/web/src/app/(app)/procurement/vendors/new/RegisterVendorForm.tsx"),
      "utf8",
    );
    const start = src.indexOf("body: JSON.stringify({");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start + "body: JSON.stringify({".length, src.indexOf("}),", start));
    const keys = [...block.matchAll(/^\s{6,}([A-Za-z]+)\s*[:,]/gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(10);
    const accepted = Object.keys(createVendorBody.shape);
    const dropped = keys.filter((k) => !accepted.includes(k));
    expect(dropped, `web form sends keys the API schema would silently strip: ${dropped.join(", ")}`).toEqual([]);
  });
});
