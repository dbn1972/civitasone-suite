/**
 * GAP-ADMIN-INVOICES-06 follow-up: offline payment (maker-checker), billing settings and reminders.
 * Real Postgres as the non-superuser billing_svc role (FORCE RLS), real Fastify, real consumers.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { billingInvoices } from "../src/modules/invoices/schema.js";
import { billingPayments } from "../src/modules/payments/schema.js";
import { applyPaymentGuarded } from "../src/modules/invoices/repo.js";
import { billingInvoiceReminders, billingOfflinePayments, billingSettingRequests, billingSettings } from "../src/modules/invoice-ops/schema.js";
import { registerInvoiceOpsConsumers } from "../src/modules/invoice-ops/consumer.js";
import { runReminderSweep } from "../src/modules/invoice-ops/sweep.js";
import { OPS_COMMANDS } from "../src/modules/invoice-ops/topics.js";

const { buildApp } = await import("../src/app.js");
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "5e8a0000-0000-4000-8000-0000000000a1";
const T2 = "5e8a0000-0000-4000-8000-0000000000b1";
const A = "5e8aacc0-0000-4000-8000-0000000000a1";
const B = "5e8aacc0-0000-4000-8000-0000000000b1";
const C = "5e8aacc0-0000-4000-8000-0000000000c1";
const tok = (actor: string, roles = ["platform_admin"], tenant = T) => ({ authorization: `Bearer ${signToken({ sub: actor, tid: tenant, roles, sid: "sess-ops" }, SECRET, 3600)}` });

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const asTenant = <R>(t: string, fn: (tx: Tx) => Promise<R>) => runWithTenant(t, () => db.transaction(fn)) as Promise<R>;
type AppT = Awaited<ReturnType<typeof buildApp>>;
let app: AppT;
const realFetch = globalThis.fetch;

async function until<R>(fn: () => Promise<R | undefined | false>, tries = 300): Promise<R> {
  for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error("condition not reached");
}
async function wipe() {
  for (const t of [T, T2]) await asTenant(t, async (tx) => {
    await tx.delete(billingOfflinePayments).where(eq(billingOfflinePayments.tenantId, t));
    await tx.delete(billingSettingRequests).where(eq(billingSettingRequests.tenantId, t));
    await tx.delete(billingSettings).where(eq(billingSettings.tenantId, t));
    await tx.delete(billingInvoiceReminders).where(eq(billingInvoiceReminders.tenantId, t));
    await tx.delete(billingPayments).where(eq(billingPayments.tenantId, t));
    await tx.delete(billingInvoices).where(eq(billingInvoices.tenantId, t));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
  });
}
const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000);
let seq = 0;
async function seedInvoice(over: Partial<typeof billingInvoices.$inferInsert> = {}, tenant = T) {
  const id = randomUUID();
  seq++;
  // (tenant, period) is unique: every seeded invoice gets its own month.
  const periodMonth = `${2000 + Math.floor(seq / 12)}-${String((seq % 12) + 1).padStart(2, "0")}`;
  await asTenant(tenant, (tx) => tx.insert(billingInvoices).values({
    id, tenantId: tenant, periodMonth, status: "issued", totalMinor: 250050n, issuedAt: daysAgo(10), createdBy: A, updatedBy: A, ...over,
  }));
  return id;
}
const invoice = async (id: string, tenant = T) => (await asTenant(tenant, (tx) => tx.select().from(billingInvoices).where(eq(billingInvoices.id, id))))[0]!;
const payments = async (id: string, tenant = T) => asTenant(tenant, (tx) => tx.select().from(billingPayments).where(eq(billingPayments.invoiceId, id)));
const requests = async (id: string, tenant = T) => asTenant(tenant, (tx) => tx.select().from(billingOfflinePayments).where(eq(billingOfflinePayments.invoiceId, id)));
const outbox = async (tenant = T) => asTenant(tenant, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, tenant)));
const audits = async (action: string, tenant = T) => (await outbox(tenant)).filter((r) => (r.payload as { action?: string }).action === action);

const NEFT = "SBIN523345678901";
const payBody = (over: Record<string, unknown> = {}) => ({ mode: "neft", reference: NEFT, paidOn: new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10), amountMinor: "250050", reason: "NEFT received in the treasury account", ...over });
const request = (id: string, body: Record<string, unknown>, actor = A, roles = ["platform_admin"]) =>
  app.inject({ method: "POST", url: `/v1/billing/invoices/${id}/offline-payments`, headers: tok(actor, roles), payload: body });
const decide = (id: string, reqId: string, body: Record<string, unknown>, actor = B) =>
  app.inject({ method: "POST", url: `/v1/billing/invoices/${id}/offline-payments/${reqId}/decision`, headers: tok(actor), payload: body });
const listReqs = async (id: string, actor = A) => (await app.inject({ method: "GET", url: `/v1/billing/invoices/${id}/offline-payments`, headers: tok(actor) })).json().data as Array<Record<string, any>>;

beforeAll(async () => {
  registerInvoiceOpsConsumers(queue);
  await queue.start();
  app = await buildApp();
  await wipe();
});
afterEach(() => { globalThis.fetch = realFetch; });
afterAll(async () => { await wipe(); await app.close(); await queue.stop(); await sqlClient.end(); });

describe("offline payment: validation and access", () => {
  it("EVERY write is platform-only (super_admin / platform_admin): billing_admin and tenant_admin get 403 on all of them, and may read", async () => {
    const id = await seedInvoice();
    const reqId = randomUUID();
    for (const roles of [["billing_admin"], ["tenant_admin"], ["billing_admin", "tenant_admin"]]) {
      const h = tok(A, roles);
      const writes: Array<[string, string, unknown]> = [
        ["POST", `/v1/billing/invoices/${id}/offline-payments`, payBody()],
        ["POST", `/v1/billing/invoices/${id}/offline-payments/${reqId}/decision`, { approve: true }],
        ["POST", "/v1/billing/settings/maker-checker", { enabled: false, reason: "needs a second approver" }],
        ["POST", `/v1/billing/settings/maker-checker/requests/${reqId}/decision`, { approve: true }],
        ["PUT", "/v1/billing/settings/reminder-days", { days: 30 }],
        ["POST", `/v1/billing/invoices/${id}/reminders`, undefined],
        ["GET", "/v1/billing/settings", undefined],
      ];
      for (const [method, url, payload] of writes) {
        const res = await app.inject({ method: method as "GET", url, headers: h, ...(payload === undefined ? {} : { payload: payload as object }) });
        expect(res.statusCode, `${roles.join("+")} ${method} ${url}`).toBe(403);
      }
      expect((await app.inject({ method: "GET", url: `/v1/billing/invoices/${id}/offline-payments`, headers: h })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: `/v1/billing/invoices/${id}/reminders`, headers: h })).statusCode).toBe(200);
    }
    expect(await requests(id)).toHaveLength(0);
    expect((await request(id, payBody({ reference: "SBIN523345670999" }), A, ["super_admin"])).statusCode).toBe(202);
    expect((await request(id, payBody(), A, ["tenant_admin"])).statusCode).toBe(403);
    expect((await request(id, payBody(), A, ["employee"])).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/v1/billing/invoices/${id}/offline-payments`, payload: payBody() })).statusCode).toBe(401);
  });

  it("refuses a bad reference, a future or too-early date, a wrong amount and a strict-schema violation, and stores nothing", async () => {
    const id = await seedInvoice();
    const future = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
    const cases: Array<[Record<string, unknown>, number, RegExp]> = [
      [payBody({ reference: "SBIN5233" }), 422, /reference: a NEFT UTR is 16/],
      [payBody({ mode: "cheque", reference: "12345" }), 422, /reference: a cheque number is 6 digits/],
      [payBody({ paidOn: future }), 422, /paidOn: cannot be in the future/],
      [payBody({ paidOn: "2020-01-01" }), 422, /paidOn: cannot be before the invoice date/],
      [payBody({ amountMinor: "100" }), 422, /amountMinor: must equal the outstanding amount \(250050 paise\)/],
      [payBody({ amountMinor: "250051" }), 422, /partial offline payments are not supported/],
      [payBody({ reason: "x" }), 400, /reason/],
      [payBody({ mode: "upi" }), 400, /mode/],
      [{ ...payBody(), extra: 1 }, 400, /Unrecognized key/],
    ];
    for (const [body, code, msg] of cases) {
      const res = await request(id, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(code);
      expect(res.json().message).toMatch(msg);
    }
    expect(await requests(id)).toHaveLength(0);
  });

  it("never alters a webhook-paid, cancelled or draft invoice", async () => {
    for (const status of ["paid", "cancelled", "draft", "waived"]) {
      const id = await seedInvoice({ status, ...(status === "paid" ? { paidMinor: 250050n } : {}) });
      const res = await request(id, payBody({ reference: `SBIN52334567${Math.floor(Math.random() * 90000 + 10000)}` }));
      expect(res.statusCode, status).toBe(409);
      expect(res.json().code).toBe("INVOICE_NOT_PAYABLE");
      expect((await invoice(id)).status).toBe(status);
      expect(await requests(id)).toHaveLength(0);
    }
  });
});

describe("offline payment: maker-checker", () => {
  it("a request is pending; the requester cannot decide it; a different administrator approves and the invoice is settled once", async () => {
    const id = await seedInvoice();
    const res = await request(id, payBody());
    expect(res.statusCode).toBe(202);
    const row = await until(async () => (await listReqs(id))[0]);
    expect(row).toMatchObject({ status: "pending", mode: "neft", reference: NEFT, amountMinor: "250050", requestedByMe: true, canDecide: false });
    expect(JSON.stringify(row)).not.toContain(A); // no actor ids leak
    expect((await invoice(id)).status).toBe("issued"); // a request alone never moves money

    const self = await decide(id, row.id, { approve: true }, A);
    expect(self.statusCode).toBe(409);
    expect(self.json().code).toBe("MAKER_CHECKER_VIOLATION");

    expect((await listReqs(id, B))[0]).toMatchObject({ requestedByMe: false, canDecide: true });
    expect((await decide(id, row.id, { approve: true }, B)).statusCode).toBe(202);
    await until(async () => (await invoice(id)).status === "paid");
    const inv = await invoice(id);
    expect(inv.paidMinor).toBe(250050n);
    const pays = await payments(id);
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ method: "offline_neft", reference: NEFT, status: "completed", amountMinor: 250050n });
    expect((await requests(id))[0]).toMatchObject({ status: "approved", autoApproved: false });
    for (const a of ["offline_payment.request", "offline_payment.approve"]) expect((await audits(a)).some((r) => (r.payload as { resourceId?: string }).resourceId === row.id), a).toBe(true);
  });

  it("the consumer itself refuses a same-actor decision (a forged command cannot bypass the route check)", async () => {
    const id = await seedInvoice();
    const ref = "SBIN523345670001";
    await request(id, payBody({ reference: ref }));
    const row = await until(async () => (await listReqs(id))[0]);
    await queue.publish(OPS_COMMANDS.offlineDecide, {
      messageId: randomUUID(), type: OPS_COMMANDS.offlineDecide, tenantId: T, actorId: A, correlationId: "c", schemaVersion: "1.0",
      payload: { requestId: row.id, invoiceId: id, approve: true },
    });
    await until(async () => (await audits("offline_payment.decide")).some((r) => (r.payload as { reason?: string }).reason === "MAKER_CHECKER_VIOLATION"));
    expect((await invoice(id)).status).toBe("issued");
    expect((await requests(id))[0]!.status).toBe("pending");
  });

  it("rejecting needs a reason, leaves the invoice alone, and frees the UTR; a duplicate UTR is refused while pending", async () => {
    const id = await seedInvoice();
    const ref = "SBIN523345670002";
    await request(id, payBody({ reference: ref }));
    const row = await until(async () => (await listReqs(id))[0]);
    // duplicate UTR (same tenant) and a second pending request on the same invoice
    const other = await seedInvoice();
    const dup = await request(other, payBody({ reference: ref.toLowerCase() }));
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("DUPLICATE_REFERENCE");
    expect((await request(id, payBody({ reference: "SBIN523345670003" }))).json().code).toBe("PENDING_EXISTS");
    // another tenant may use the same UTR
    const t2inv = await seedInvoice({}, T2);
    expect((await app.inject({ method: "POST", url: `/v1/billing/invoices/${t2inv}/offline-payments`, headers: tok(A, ["platform_admin"], T2), payload: payBody({ reference: ref }) })).statusCode).toBe(202);

    expect((await decide(id, row.id, { approve: false }, B)).statusCode).toBe(400);
    expect((await decide(id, row.id, { approve: false, reason: "UTR not found on the bank statement" }, B)).statusCode).toBe(202);
    await until(async () => (await requests(id))[0]!.status === "rejected");
    expect((await invoice(id)).status).toBe("issued");
    expect(await payments(id)).toHaveLength(0);
    expect((await decide(id, row.id, { approve: true }, B)).statusCode).toBe(409); // no longer pending
    expect((await request(other, payBody({ reference: ref }))).statusCode).toBe(202); // reusable once rejected
  });

  it("approval is conditional: if the invoice was paid in part since the request, it is closed as rejected and NOT altered", async () => {
    const id = await seedInvoice();
    await request(id, payBody({ reference: "SBIN523345670004" }));
    const row = await until(async () => (await listReqs(id))[0]);
    await asTenant(T, (tx) => tx.update(billingInvoices).set({ paidMinor: 50000n, status: "partially_paid" }).where(eq(billingInvoices.id, id)));
    expect((await decide(id, row.id, { approve: true }, B)).statusCode).toBe(202);
    await until(async () => (await requests(id))[0]!.status === "rejected");
    expect((await requests(id))[0]!.decisionReason).toMatch(/invoice changed/);
    const inv = await invoice(id);
    expect([inv.status, inv.paidMinor]).toEqual(["partially_paid", 50000n]);
    expect(await payments(id)).toHaveLength(0);
  });

  it("two administrators approving at the same time settle the invoice exactly once", async () => {
    const id = await seedInvoice();
    await request(id, payBody({ reference: "SBIN523345670005" }));
    const row = await until(async () => (await listReqs(id))[0]);
    await Promise.all([decide(id, row.id, { approve: true }, B), decide(id, row.id, { approve: true }, C)]);
    await until(async () => (await invoice(id)).status === "paid");
    await new Promise((r) => setTimeout(r, 500));
    expect(await payments(id)).toHaveLength(1);
    expect((await invoice(id)).paidMinor).toBe(250050n);
  });
});

describe("maker-checker setting: turning it off needs a second approver", () => {
  const settingsReq = (body: Record<string, unknown>, actor = A) => app.inject({ method: "POST", url: "/v1/billing/settings/maker-checker", headers: tok(actor), payload: body });
  const getSettings = async (actor = A) => (await app.inject({ method: "GET", url: "/v1/billing/settings", headers: tok(actor) })).json().data;
  const decideSetting = (reqId: string, body: Record<string, unknown>, actor: string) => app.inject({ method: "POST", url: `/v1/billing/settings/maker-checker/requests/${reqId}/decision`, headers: tok(actor), payload: body });

  it("defaults ON; OFF is only a pending request, approved by someone else, and then offline payments settle in one step (still audited)", async () => {
    expect((await getSettings()).offlineMakerChecker).toBe(true);
    expect((await settingsReq({ enabled: false, reason: "small office, one administrator on duty" })).statusCode).toBe(202);
    const pending = await until(async () => (await getSettings()).pendingMakerCheckerRequest);
    expect(pending.requestedByMe).toBe(true);
    expect((await getSettings()).offlineMakerChecker).toBe(true); // not off yet
    expect((await decideSetting(pending.id, { approve: true }, A)).json().code).toBe("MAKER_CHECKER_VIOLATION");
    expect((await decideSetting(pending.id, { approve: true, reason: "agreed" }, B)).statusCode).toBe(202);
    await until(async () => (await getSettings()).offlineMakerChecker === false);

    const id = await seedInvoice();
    await request(id, payBody({ reference: "SBIN523345670006" }));
    await until(async () => (await invoice(id)).status === "paid");
    expect((await requests(id))[0]).toMatchObject({ status: "approved", autoApproved: true });
    expect((await audits("offline_payment.approve")).some((r) => (r.payload as { auto?: boolean }).auto === true)).toBe(true);

    // switching it back ON is immediate
    expect((await settingsReq({ enabled: true, reason: "back to two-person control" })).statusCode).toBe(202);
    await until(async () => (await getSettings()).offlineMakerChecker === true);
  });

  it("a rejected disable request keeps it ON; only one disable request can be pending", async () => {
    await settingsReq({ enabled: false, reason: "first request reason" });
    const pending = await until(async () => (await getSettings()).pendingMakerCheckerRequest);
    await settingsReq({ enabled: false, reason: "second request reason" });
    await new Promise((r) => setTimeout(r, 400));
    expect((await asTenant(T, (tx) => tx.select().from(billingSettingRequests).where(and(eq(billingSettingRequests.tenantId, T), eq(billingSettingRequests.status, "pending"))))).length).toBe(1);
    expect((await decideSetting(pending.id, { approve: false, reason: "not needed" }, B)).statusCode).toBe(202);
    await until(async () => !(await getSettings()).pendingMakerCheckerRequest);
    expect((await getSettings()).offlineMakerChecker).toBe(true);
  });
});

describe("reminders", () => {
  const admins = (rows: Array<{ id: string; name: string; email: string }> | "down") => {
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (!String(input).includes("/identity/internal/tenant-admins")) return realFetch(input, init);
      const h = (init?.headers ?? {}) as Record<string, string>;
      expect(h["x-tenant-id"]).toMatch(/^5e8a0000/); // tenant-scoped lookup, internal headers
      expect(h["x-internal"]).toBe("1");
      if (rows === "down") return new Response("{}", { status: 500 });
      return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  };
  const remind = (id: string, actor = A) => app.inject({ method: "POST", url: `/v1/billing/invoices/${id}/reminders`, headers: tok(actor) });
  const sent = async (tenant = T) => (await outbox(tenant)).filter((r) => r.topic === "notification.send");

  it("says so (never a silent success) when nobody can be reached", async () => {
    const id = await seedInvoice();
    admins([]);
    const none = await remind(id);
    expect(none.statusCode).toBe(422);
    expect(none.json().code).toBe("NO_RECIPIENTS");
    admins("down");
    const down = await remind(id);
    expect(down.statusCode).toBe(503);
    expect(down.json().code).toBe("RECIPIENTS_UNAVAILABLE");
    admins([{ id: B, name: "No Email", email: "not-an-address" }]);
    expect((await remind(id)).json().code).toBe("NO_RECIPIENTS");
    expect(await sent()).toHaveLength(0);
  });

  it("sends through the standard template path to every active tenant admin, audited, and then limits to 1 per invoice per 24 h", async () => {
    const id = await seedInvoice({ paidMinor: 50000n, status: "partially_paid", periodMonth: "2026-09" });
    admins([{ id: B, name: "Asha Rao", email: "asha@dept.gov.in" }, { id: C, name: "Vikram Iyer", email: "vikram@dept.gov.in" }]);
    const ok = await remind(id);
    expect(ok.statusCode).toBe(202);
    expect(ok.json().recipientCount).toBe(2);
    const mails = await until(async () => { const m = await sent(); return m.length >= 2 ? m : undefined; });
    expect(mails).toHaveLength(2);
    const p = mails.map((m) => m.payload as Record<string, any>).sort((a, b) => a.recipient.localeCompare(b.recipient));
    expect(p[0]).toMatchObject({ templateId: "00000000-0000-4000-8001-00000000000e", recipient: "asha@dept.gov.in", recipientId: B, channel: "email", eventType: "billing.invoice.reminder" });
    expect(p[0].variables).toEqual({ name: "Asha Rao", period: "2026-09", outstanding: "Rs 2,000.50" });
    expect((await audits("invoice.reminder")).some((r) => (r.payload as { outcome?: string }).outcome === "success")).toBe(true);

    const again = await remind(id);
    expect(again.statusCode).toBe(429);
    expect(again.json().code).toBe("REMINDER_RATE_LIMITED");
    const status = (await app.inject({ method: "GET", url: `/v1/billing/invoices/${id}/reminders`, headers: tok(A, ["tenant_admin"]) })).json().data;
    expect(status.count).toBe(1);
    expect(new Date(status.nextAllowedAt).getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000);
    expect(new Date(status.lastSentAt).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("two parallel reminder requests send once (the consumer enforces the limit under the invoice lock)", async () => {
    const id = await seedInvoice();
    admins([{ id: B, name: "Asha Rao", email: "asha2@dept.gov.in" }]);
    const before = (await sent()).length;
    const [a, b] = await Promise.all([remind(id), remind(id, B)]);
    expect([a.statusCode, b.statusCode].filter((c) => c === 202).length).toBeGreaterThanOrEqual(1);
    await until(async () => (await sent()).length > before);
    await new Promise((r) => setTimeout(r, 700));
    expect((await sent()).length - before).toBe(1);
    expect(await asTenant(T, (tx) => tx.select().from(billingInvoiceReminders).where(eq(billingInvoiceReminders.invoiceId, id)))).toHaveLength(1);
  });

  it("nothing is due: a paid invoice cannot be reminded; reminders need an ops role", async () => {
    const paid = await seedInvoice({ status: "paid", paidMinor: 250050n });
    expect((await remind(paid)).json().code).toBe("NOTHING_DUE");
    const id = await seedInvoice();
    expect((await app.inject({ method: "POST", url: `/v1/billing/invoices/${id}/reminders`, headers: tok(A, ["tenant_admin"]) })).statusCode).toBe(403);
  });

  it("scheduled reminders are OFF by default, then go out at N days overdue (once per week per invoice), only for tenants that opted in", async () => {
    const old = await seedInvoice({ issuedAt: daysAgo(40) });
    const fresh = await seedInvoice({ issuedAt: daysAgo(2) });
    admins([{ id: B, name: "Asha Rao", email: "asha3@dept.gov.in" }]);
    const before = (await sent()).length;
    expect((await runReminderSweep()).queued).toBe(0); // default OFF
    expect((await app.inject({ method: "PUT", url: "/v1/billing/settings/reminder-days", headers: tok(A), payload: { days: 0 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/v1/billing/settings/reminder-days", headers: tok(A), payload: { days: 30 } })).statusCode).toBe(202);
    await until(async () => (await app.inject({ method: "GET", url: "/v1/billing/settings", headers: tok(A) })).json().data.reminderOverdueDays === 30);
    const first = await runReminderSweep();
    expect(first.queued).toBeGreaterThanOrEqual(1);
    await until(async () => (await asTenant(T, (tx) => tx.select().from(billingInvoiceReminders).where(eq(billingInvoiceReminders.invoiceId, old)))).length === 1);
    const row = (await asTenant(T, (tx) => tx.select().from(billingInvoiceReminders).where(eq(billingInvoiceReminders.invoiceId, old))))[0]!;
    expect(row.triggerKind).toBe("scheduled");
    expect(await asTenant(T, (tx) => tx.select().from(billingInvoiceReminders).where(eq(billingInvoiceReminders.invoiceId, fresh)))).toHaveLength(0);
    // a second sweep inside the weekly window sends nothing more
    await runReminderSweep();
    await new Promise((r) => setTimeout(r, 700));
    expect(await asTenant(T, (tx) => tx.select().from(billingInvoiceReminders).where(eq(billingInvoiceReminders.invoiceId, old)))).toHaveLength(1);
    expect((await sent()).length).toBeGreaterThan(before);
    // switching it off again
    await app.inject({ method: "PUT", url: "/v1/billing/settings/reminder-days", headers: tok(A), payload: { days: null } });
    await until(async () => (await app.inject({ method: "GET", url: "/v1/billing/settings", headers: tok(A) })).json().data.reminderOverdueDays === null);
  });
});

describe("review hardening", () => {
  const getSettings = async (actor = A) => (await app.inject({ method: "GET", url: "/v1/billing/settings", headers: tok(actor) })).json().data;

  it("a reference is unique per tenant AND mode: a cheque and a draft may share a number, a repeated NEFT UTR may not", async () => {
    const a = await seedInvoice();
    const b = await seedInvoice();
    const c = await seedInvoice();
    expect((await request(a, payBody({ mode: "cheque", reference: "445566" }))).statusCode).toBe(202);
    await until(async () => (await requests(a)).length === 1);
    expect((await request(b, payBody({ mode: "dd", reference: "445566" }))).statusCode).toBe(202); // other mode: allowed
    const clash = await request(c, payBody({ mode: "cheque", reference: "445566" }));
    expect(clash.statusCode).toBe(409);
    expect(clash.json().code).toBe("DUPLICATE_REFERENCE");
  });

  it("a request that loses a race on the unique indexes shows up as a REFUSED row (never a silent success)", async () => {
    const id = await seedInvoice();
    const send = (requestId: string) => queue.publish(OPS_COMMANDS.offlineRequest, {
      messageId: randomUUID(), type: OPS_COMMANDS.offlineRequest, tenantId: T, actorId: A, correlationId: "c", schemaVersion: "1.0",
      payload: { requestId, invoiceId: id, mode: "neft", reference: "SBIN523345679901", referenceNorm: "SBIN523345679901", paidOn: new Date(Date.now() - 86400_000).toISOString().slice(0, 10), amountMinor: "250050", reason: "racing request" },
    });
    await Promise.all([send(randomUUID()), send(randomUUID())]); // bypasses the route pre-check, as a lost race would
    await until(async () => (await requests(id)).length === 2);
    const rows = await requests(id);
    expect(rows.filter((r) => r.status === "pending")).toHaveLength(1);
    const refused = rows.find((r) => r.status === "rejected")!;
    expect(refused.decisionReason).toMatch(/Refused: this UTR/);
    expect((await listReqs(id)).map((r) => r.status).sort()).toEqual(["pending", "rejected"]);
  });

  it("switching maker-checker off while another request is pending is a synchronous 409; and switching off when already off too", async () => {
    const off = (actor = A) => app.inject({ method: "POST", url: "/v1/billing/settings/maker-checker", headers: tok(actor), payload: { enabled: false, reason: "second request for the same thing" } });
    expect((await off()).statusCode).toBe(202);
    await until(async () => (await getSettings()).pendingMakerCheckerRequest);
    const again = await off(B);
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe("PENDING_EXISTS");
    const pending = (await getSettings()).pendingMakerCheckerRequest;
    await app.inject({ method: "POST", url: `/v1/billing/settings/maker-checker/requests/${pending.id}/decision`, headers: tok(B), payload: { approve: true, reason: "agreed" } });
    await until(async () => (await getSettings()).offlineMakerChecker === false);
    expect((await off()).json().code).toBe("ALREADY_OFF");
    await app.inject({ method: "POST", url: "/v1/billing/settings/maker-checker", headers: tok(A), payload: { enabled: true, reason: "restore two-person approval" } });
    await until(async () => (await getSettings()).offlineMakerChecker === true);
  });

  it("the route reminder limit counts SCHEDULED sends too, and a blocked click gets 429 with the next-allowed time", async () => {
    const id = await seedInvoice();
    await asTenant(T, (tx) => tx.insert(billingInvoiceReminders).values({ id: randomUUID(), tenantId: T, invoiceId: id, triggerKind: "scheduled", recipientCount: 1, sentAt: new Date(Date.now() - 3600_000) }));
    globalThis.fetch = (async () => new Response(JSON.stringify([{ id: B, name: "Asha", email: "a@dept.gov.in" }]), { status: 200 })) as typeof fetch;
    const blocked = await app.inject({ method: "POST", url: `/v1/billing/invoices/${id}/reminders`, headers: tok(A) });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().code).toBe("REMINDER_RATE_LIMITED");
    const next = new Date(blocked.json().nextAllowedAt).getTime();
    expect(next).toBeGreaterThan(Date.now() + 22 * 3600_000);
    expect(next).toBeLessThan(Date.now() + 24 * 3600_000);
    const status = (await app.inject({ method: "GET", url: `/v1/billing/invoices/${id}/reminders`, headers: tok(A, ["tenant_admin"]) })).json().data;
    expect(status.nextAllowedAt).toBe(blocked.json().nextAllowedAt);
  });

  it("the database itself refuses a maker approving their own request (CHECK), except the auto-approval path", async () => {
    const id = await seedInvoice();
    const base = { id: randomUUID(), tenantId: T, invoiceId: id, mode: "neft", reference: "SBIN523345670077", referenceNorm: "SBIN523345670077", paidOn: "2026-09-20", amountMinor: 1n, reason: "check", requestedBy: A };
    await expect(asTenant(T, (tx) => tx.insert(billingOfflinePayments).values({ ...base, status: "approved", decidedBy: A }))).rejects.toThrow(/ck_offline_payments_maker_checker/);
    await asTenant(T, (tx) => tx.insert(billingOfflinePayments).values({ ...base, id: randomUUID(), referenceNorm: "SBIN523345670078", reference: "SBIN523345670078", status: "approved", decidedBy: B }));
    await asTenant(T, (tx) => tx.insert(billingOfflinePayments).values({ ...base, id: randomUUID(), referenceNorm: "SBIN523345670079", reference: "SBIN523345670079", status: "approved", decidedBy: A, autoApproved: true }));
  });

  describe("a gateway webhook racing an offline approval (both orders)", () => {
    const webhookPays = (id: string, amount: bigint) => asTenant(T, (tx) => applyPaymentGuarded(tx as never, id, amount, A));

    it("webhook first (holds the invoice row): the approval waits, then closes the request as rejected and leaves the webhook's state alone", async () => {
      const id = await seedInvoice();
      await request(id, payBody({ reference: "SBIN523345671001" }));
      const row = await until(async () => (await listReqs(id))[0]);
      let release!: () => void;
      const hold = new Promise<void>((r) => { release = r; });
      const webhook = asTenant(T, async (tx) => {
        const done = await applyPaymentGuarded(tx as never, id, 250050n, A); // full payment lands first, row stays locked
        await hold;
        return done;
      });
      await new Promise((r) => setTimeout(r, 300));
      await decide(id, row.id, { approve: true }, B); // consumer blocks on FOR UPDATE
      await new Promise((r) => setTimeout(r, 500));
      expect((await requests(id))[0]!.status).toBe("pending"); // still waiting for the lock
      release();
      expect((await webhook)?.status).toBe("paid");
      await until(async () => (await requests(id))[0]!.status === "rejected");
      expect((await requests(id))[0]!.decisionReason).toMatch(/invoice changed/);
      expect(await payments(id)).toHaveLength(0); // no second (offline) payment row
      expect((await invoice(id)).paidMinor).toBe(250050n);
    });

    it("approval first: the invoice is settled once, and the late webhook is refused by its own guard", async () => {
      const id = await seedInvoice();
      await request(id, payBody({ reference: "SBIN523345671002" }));
      const row = await until(async () => (await listReqs(id))[0]);
      await decide(id, row.id, { approve: true }, B);
      await until(async () => (await invoice(id)).status === "paid");
      expect(await webhookPays(id, 250050n)).toBeUndefined();
      const pays = await payments(id);
      expect(pays).toHaveLength(1);
      expect(pays[0]!.method).toBe("offline_neft");
      expect((await invoice(id)).paidMinor).toBe(250050n);
    });
  });
});
