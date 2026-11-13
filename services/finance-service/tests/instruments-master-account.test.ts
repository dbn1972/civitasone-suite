/**
 * An instrument's bankAccountId may be an account of the bank-account master (payments.finance_bank_accounts,
 * what POST /v1/finance/bank-accounts writes). The last-4 display and the audited reveal resolve it there
 * (falling back to treasury.finance_banks for older rows, covered by fp02-instruments.test.ts). Real DB, real routes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeBankAccounts } from "../src/modules/payments/schema.js";
import { bearer, auditRows, wipeOutbox, startConsumers, drain } from "./_fp02.js";

const T = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();
const MASTER = randomUUID();
const FOREIGN = randomUUID();
const ACCOUNT = "30098765434321";
const FOREIGN_ACCOUNT = "99887766551111";

const fin = () => bearer(T, ACTOR, ["finance_officer"]);
let app: Awaited<ReturnType<typeof buildApp>>;
let seq = 0;

async function issue(bankAccountId: string): Promise<string> {
  const res = await app.inject({
    method: "POST", url: "/v1/finance/instruments", headers: fin(),
    payload: { instrumentType: "cheque", instrumentNo: `MA-${Date.now()}-${++seq}`, bankName: "SBI", payee: "M/s Test", amountMinor: 250000, bankAccountId },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}
const reveal = async (id: string) => {
  const res = await app.inject({ method: "POST", url: `/v1/finance/instruments/${id}/reveal-account`, headers: fin(), payload: { reason: "Bank reconciliation query" } });
  await drain();
  return res;
};

beforeAll(async () => {
  app = await buildApp();
  await startConsumers();
  for (const [tenantId, id, accountNo] of [[T, MASTER, ACCOUNT], [OTHER, FOREIGN, FOREIGN_ACCOUNT]] as const) {
    await scoped(tenantId, (tx) => tx.insert(financeBankAccounts).values({ id, tenantId, bankName: "State Bank of India", accountNo, ifsc: "SBIN0001234", createdBy: ACTOR }));
  }
});
afterAll(async () => {
  await wipeOutbox(T).catch(() => {});
  await scoped(T, (tx) => tx.delete(financeBankAccounts).where(eq(financeBankAccounts.tenantId, T))).catch(() => {});
  await scoped(OTHER, (tx) => tx.delete(financeBankAccounts).where(eq(financeBankAccounts.tenantId, OTHER))).catch(() => {});
  await app.close();
  await sqlClient.end();
});

describe("instrument with a bank-account-master id", () => {
  it("detail and list show the right last four digits and never the number", async () => {
    const id = await issue(MASTER);
    const detail = (await app.inject({ method: "GET", url: `/v1/finance/instruments/${id}`, headers: fin() })).json();
    expect(detail.accountNoLast4).toBe("4321");
    expect(JSON.stringify(detail)).not.toContain(ACCOUNT);
    const list = (await app.inject({ method: "GET", url: "/v1/finance/instruments", headers: fin() })).json();
    const rows = (Array.isArray(list) ? list : list.items ?? list.data) as Array<{ id: string; accountNoLast4: string | null }>;
    expect(rows.find((r) => r.id === id)?.accountNoLast4).toBe("4321");
  });

  it("the audited reveal returns the number, writes the audit row, and the row never holds the number", async () => {
    const id = await issue(MASTER);
    const res = await reveal(id);
    expect(res.statusCode).toBe(200);
    expect(res.json().accountNo).toBe(ACCOUNT);
    expect(res.headers["cache-control"]).toBe("no-store");
    const rows = await auditRows(T, "account_reveal", id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorId).toBe(ACTOR);
    expect(JSON.stringify(rows[0]!.payload)).toContain(MASTER);
    expect(JSON.stringify(rows[0]!.payload)).not.toContain(ACCOUNT);
  });

  it("another tenant's account id resolves to nothing: no last-4, reveal 404, no audit row", async () => {
    const id = await issue(FOREIGN);
    const detail = (await app.inject({ method: "GET", url: `/v1/finance/instruments/${id}`, headers: fin() })).json();
    expect(detail.accountNoLast4).toBeNull();
    const res = await reveal(id);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NO_BANK_ACCOUNT");
    expect(JSON.stringify(res.json())).not.toContain(FOREIGN_ACCOUNT);
    expect(await auditRows(T, "account_reveal", id)).toHaveLength(0);
  });
});
