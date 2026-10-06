/**
 * GAP-NOTIFICATIONS-DELIVERIES-01 / -DETAIL-02 (DPDP): the deliveries LIST
 * route must not emit a clear recipient (the web client caches the list
 * offline). The per-delivery DETAIL route still returns the clear recipient
 * because Resend needs it. DB-backed, seeds + cleans its own tenant rows.
 */
import { describe, it, expect, afterAll, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "eeeeeeee-9999-4000-8000-0000000000dd";
const TEMPLATE = "eeeeeeee-8888-4000-8000-0000000000cc";
const ACTOR = "eeeeeeee-7777-4000-8000-0000000000bb";
const CLEAR_EMAIL = "asha.kumari@example.gov.in";
const DELIVERY_ID = "eeeeeeee-1111-4000-8000-0000000000a1";

function adminToken() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["notification_admin"], sid: "sess-pii" }, SECRET);
}

async function sqlAsTenant<T>(fn: (sql: typeof sqlClient) => Promise<T> | T): Promise<T> {
  return sqlClient.begin(async (sql) => {
    await sql`select set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(sql as unknown as typeof sqlClient);
  }) as Promise<T>;
}

async function seed(): Promise<void> {
  await sqlAsTenant((sql) => sql`
    INSERT INTO deliveries.deliveries
      (id, tenant_id, template_id, recipient, recipient_id, channel, status, retry_count, created_by, updated_by, version)
    VALUES
      (${DELIVERY_ID}, ${TENANT}, ${TEMPLATE}, ${CLEAR_EMAIL}, ${null}, 'email', 'delivered', 1, ${TENANT}, ${TENANT}, 1)`);
}
async function cleanup(): Promise<void> {
  await sqlAsTenant((sql) => sql`DELETE FROM deliveries.deliveries WHERE tenant_id = ${TENANT}`);
}

beforeEach(cleanup);
afterEach(cleanup);
afterAll(async () => { await sqlClient.end(); });

describe("GAP-NOTIFICATIONS-DELIVERIES-01 — list recipient is masked", () => {
  it("GET /notifications/deliveries never returns the clear recipient", async () => {
    await seed();
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/deliveries",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ id: string; recipient: string }>;
    const row = rows.find((r) => r.id === DELIVERY_ID);
    expect(row).toBeTruthy();
    // The clear email must not appear anywhere in the serialized list payload.
    expect(res.payload).not.toContain(CLEAR_EMAIL);
    expect(row!.recipient).not.toBe(CLEAR_EMAIL);
    // It is a mask of the original (keeps the first local char).
    expect(row!.recipient.startsWith("a")).toBe(true);
    expect(row!.recipient).toContain("@");
  });

  it("GET /notifications/deliveries/:id still returns the clear recipient (Resend needs it)", async () => {
    await seed();
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/notifications/deliveries/${DELIVERY_ID}`,
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const row = res.json() as { recipient: string };
    expect(row.recipient).toBe(CLEAR_EMAIL);
  });
});
