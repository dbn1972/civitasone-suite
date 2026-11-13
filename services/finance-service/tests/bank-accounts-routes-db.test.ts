/**
 * masters/bank-routes.ts against a real DB: create (202 -> consumer writes payments.finance_bank_accounts), list
 * (masked), reveal (full number, audited), duplicate 409, tenant isolation. Guards the shared financeBankAccounts table
 * definition the routes now use.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { scoped } from "./_tenant.js";
import { registerMastersConsumers } from "../src/modules/masters/consumer.js";
import { financeBankAccounts } from "../src/modules/payments/schema.js";
import { bearer, auditRows, wipeOutbox, startConsumers, drain } from "./_fp02.js";

const T = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();
const ACCOUNT = "30098765434321";
const BODY = { bankName: "State Bank of India", branchName: "Main Branch", accountNo: ACCOUNT, ifsc: "sbin0001234", accountType: "current", purpose: "Salary" };

const admin = (tenant = T) => bearer(tenant, ACTOR, ["finance_admin"]);
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  app = await buildApp();
  registerMastersConsumers(queue);
  await startConsumers();
});
afterAll(async () => {
  await wipeOutbox(T).catch(() => {});
  await scoped(T, (tx) => tx.delete(financeBankAccounts).where(eq(financeBankAccounts.tenantId, T))).catch(() => {});
  await app.close();
  await sqlClient.end();
});

describe("bank-account routes", () => {
  let id = "";

  it("create returns 202; the consumer writes the row; list shows it masked", async () => {
    const created = await app.inject({ method: "POST", url: "/v1/finance/bank-accounts", headers: admin(), payload: BODY });
    expect(created.statusCode).toBe(202);
    id = created.json().id as string;
    await drain();

    const rows = await scoped(T, (tx) => tx.select().from(financeBankAccounts).where(eq(financeBankAccounts.id, id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId: T, bankName: BODY.bankName, status: "active", accountType: "current" });
    expect(String(rows[0]!.accountNo)).toBe(ACCOUNT); // decrypted by the column type, encrypted at rest

    const list = await app.inject({ method: "GET", url: "/v1/finance/bank-accounts", headers: admin() });
    expect(list.statusCode).toBe(200);
    const data = list.json().data as Array<Record<string, unknown>>;
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ id, bankName: BODY.bankName, branchName: "Main Branch", accountNoLast4: "4321", ifsc: "SBIN0001234", accountType: "current", status: "active" });
    expect(JSON.stringify(list.json())).not.toContain(ACCOUNT);
  });

  it("the account number is ciphertext in the table", async () => {
    const res = await scoped(T, (tx) => tx.execute(sql`SELECT account_no FROM payments.finance_bank_accounts WHERE id = ${id}::uuid`));
    const raw = (res as unknown as Array<{ account_no: string }>)[0];
    expect(raw).toBeDefined();
    expect(String(raw!.account_no)).not.toContain(ACCOUNT);
  });

  it("registering the same IFSC + account again is 409 BANK_ACCOUNT_EXISTS", async () => {
    const dup = await app.inject({ method: "POST", url: "/v1/finance/bank-accounts", headers: admin(), payload: BODY });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("BANK_ACCOUNT_EXISTS");
  });

  it("reveal needs a reason, returns the full number with no-store, and audits without the number", async () => {
    const short = await app.inject({ method: "POST", url: `/v1/finance/bank-accounts/${id}/reveal`, headers: admin(), payload: { reason: "short" } });
    expect(short.statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: `/v1/finance/bank-accounts/${id}/reveal`, headers: admin(), payload: { reason: "Bank reconciliation query" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ id, accountNo: ACCOUNT, ifsc: "SBIN0001234" });
    expect(ok.headers["cache-control"]).toBe("no-store");
    await drain();
    const rows = await auditRows(T, "reveal_bank_account", id);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]!.payload)).toContain("Bank reconciliation query");
    expect(JSON.stringify(rows[0]!.payload)).not.toContain(ACCOUNT);
  });

  it("another tenant sees none of it: empty list, reveal 404", async () => {
    const list = await app.inject({ method: "GET", url: "/v1/finance/bank-accounts", headers: admin(OTHER) });
    expect(list.json().data).toEqual([]);
    const reveal = await app.inject({ method: "POST", url: `/v1/finance/bank-accounts/${id}/reveal`, headers: admin(OTHER), payload: { reason: "Bank reconciliation query" } });
    expect(reveal.statusCode).toBe(404);
  });
});
