/**
 * GAP-CRM-ESCALATION-RULES-05 — creating a second lead-escalation rule with the
 * same trigger + threshold + recipient must be refused with 409 DUPLICATE_RULE
 * (two identical rules would both fire and double-notify / double-reassign a
 * lead). A rule with a different threshold still creates cleanly.
 *
 * DB-backed, HTTP round-trip (CQRS reads back after the queue drains).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();

function headers(roles: string[] = ["crm_admin"]): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-esc5" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

async function call(method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) {
  const app = await buildApp();
  const res = await app.inject({ method, url, headers: headers(), ...(payload === undefined ? {} : { payload }) });
  await app.close();
  await drainQueue();
  return res;
}

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function cleanup(): Promise<void> {
  await scoped((tx) => tx`DELETE FROM crm.escalation_rules WHERE tenant_id = ${TENANT}`).catch(() => {});
}

beforeAll(async () => {
  registerAllConsumers(queue);
  await queue.start();
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

const RULE = {
  name: "Escalate unaccepted after 1h",
  trigger: "unaccepted" as const,
  thresholdMinutes: 60,
  recipientRole: "sales_manager",
};

describe("GAP-CRM-ESCALATION-RULES-05: duplicate escalation-rule guard", () => {
  it("refuses a second identical rule with 409 DUPLICATE_RULE", async () => {
    const first = await call("POST", "/v1/crm/escalation-rules", RULE);
    expect([200, 202]).toContain(first.statusCode);

    const dup = await call("POST", "/v1/crm/escalation-rules", RULE);
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error?.code ?? dup.json().code).toBe("DUPLICATE_RULE");

    // Only one rule persisted.
    const rows = (await scoped((tx) => tx`SELECT id FROM crm.escalation_rules WHERE tenant_id = ${TENANT}`)) as unknown as Array<{ id: string }>;
    expect(rows.length).toBe(1);
  });

  it("allows a rule that differs only by threshold", async () => {
    const other = await call("POST", "/v1/crm/escalation-rules", { ...RULE, thresholdMinutes: 120 });
    expect([200, 202]).toContain(other.statusCode);

    const rows = (await scoped((tx) => tx`SELECT threshold_minutes FROM crm.escalation_rules WHERE tenant_id = ${TENANT} ORDER BY threshold_minutes`)) as unknown as Array<{ threshold_minutes: number }>;
    expect(rows.map((r) => r.threshold_minutes)).toEqual([60, 120]);
  });
});
