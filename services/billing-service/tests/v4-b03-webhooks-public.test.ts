/**
 * V4-B-03: the Razorpay / PayU / CCAvenue server-to-server webhooks were not `config.public`, so
 * authPlugin 401'd every gateway callback. They are now public and authenticate ONLY via the
 * provider signature: Razorpay HMAC over the RAW bytes, PayU reverse hash, CCAvenue encResp
 * decrypted with the working key. Unsigned / forged callbacks are rejected before anything is queued.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";

const rnd = () => globalThis.crypto.randomUUID();
const RZP_SECRET = rnd();
const PAYU_KEY = rnd().slice(0, 8);
const PAYU_SALT = rnd();
const CCA_KEY = rnd();
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000a1";

let app: FastifyInstance;
let published: Array<{ topic: string; msg: Record<string, unknown> }> = [];

beforeAll(async () => {
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", RZP_SECRET);
  vi.stubEnv("PAYU_MERCHANT_KEY", PAYU_KEY);
  vi.stubEnv("PAYU_SALT", PAYU_SALT);
  vi.stubEnv("CCAVENUE_WORKING_KEY", CCA_KEY);
  const { queue } = await import("../src/shared/infra.js");
  vi.spyOn(queue, "publish").mockImplementation((async (topic: string, msg: Record<string, unknown>) => {
    published.push({ topic, msg });
  }) as never);
  const { authPlugin } = await import("@civitasone/auth/plugin");
  const { checkoutRoutes } = await import("../src/modules/payments/checkout-routes.js");
  const { gatewayRoutes } = await import("../src/modules/gateways/routes.js");
  app = Fastify({ logger: false });
  await app.register(authPlugin);
  await app.register(checkoutRoutes);
  await app.register(gatewayRoutes);
  await app.ready();
});
afterAll(async () => { await app.close(); vi.unstubAllEnvs(); });
beforeEach(() => { published = []; });

const rzpSig = (raw: string) => createHmac("sha256", RZP_SECRET).update(raw).digest("hex");
const rzpEvent = (tenant = TENANT) => ({
  event: "payment.captured",
  payload: { payment: { entity: { id: "pay_1", order_id: "order_1", amount: 5000, notes: { tenantId: tenant } } } },
});

describe("POST /v1/billing/webhooks/razorpay", () => {
  it("accepts an anonymous, correctly signed callback and queues it under the signed tenant", async () => {
    const raw = JSON.stringify(rzpEvent());
    const res = await app.inject({ method: "POST", url: "/v1/billing/webhooks/razorpay", headers: { "content-type": "application/json", "x-razorpay-signature": rzpSig(raw) }, payload: raw });
    expect(res.statusCode).toBe(200);
    expect(published).toHaveLength(1);
    expect(published[0]!.msg["tenantId"]).toBe(TENANT);
  });

  it("verifies the HMAC over the RAW bytes, not a re-serialised parse (pretty-printed body)", async () => {
    const raw = JSON.stringify(rzpEvent(), null, 2);
    const res = await app.inject({ method: "POST", url: "/v1/billing/webhooks/razorpay", headers: { "content-type": "application/json", "x-razorpay-signature": rzpSig(raw) }, payload: raw });
    expect(res.statusCode).toBe(200);
  });

  it("rejects a forged / missing signature and queues nothing", async () => {
    const raw = JSON.stringify(rzpEvent());
    const bad = await app.inject({ method: "POST", url: "/v1/billing/webhooks/razorpay", headers: { "content-type": "application/json", "x-razorpay-signature": rzpSig(raw + " ") }, payload: raw });
    expect(bad.statusCode).toBe(401);
    expect(bad.json()).toMatchObject({ code: "UNAUTHORIZED", message: "unauthorized" });
    const none = await app.inject({ method: "POST", url: "/v1/billing/webhooks/razorpay", headers: { "content-type": "application/json" }, payload: raw });
    expect(none.statusCode).toBe(400);
    expect(published).toHaveLength(0);
  });

  it("rejects an oversize unsigned body (413) without queuing anything", async () => {
    const raw = JSON.stringify({ event: "x", pad: "a".repeat(1_048_576 + 1024) });
    const res = await app.inject({ method: "POST", url: "/v1/billing/webhooks/razorpay", headers: { "content-type": "application/json" }, payload: raw });
    expect(res.statusCode).toBe(413);
    expect(published).toHaveLength(0);
  });

  it("rejects an oversize chunked body (no content-length) with 413 and queues nothing", async () => {
    const { Readable } = await import("node:stream");
    const big = Buffer.alloc(1_048_576 + 1024, 97);
    const stream = Readable.from([big.subarray(0, 600_000), big.subarray(600_000)]);
    const res = await app.inject({ method: "POST", url: "/v1/billing/webhooks/razorpay", headers: { "content-type": "application/json" }, payload: stream });
    expect(res.statusCode).toBe(413);
    expect(published).toHaveLength(0);
  });

  it("falls back to the system tenant when the signed notes carry no valid tenant id", async () => {
    const raw = JSON.stringify(rzpEvent("not-a-uuid"));
    const res = await app.inject({ method: "POST", url: "/v1/billing/webhooks/razorpay", headers: { "content-type": "application/json", "x-razorpay-signature": rzpSig(raw) }, payload: raw });
    expect(res.statusCode).toBe(200);
    expect(published[0]!.msg["tenantId"]).toBe("system");
  });
});

function payuForm(over: Record<string, string> = {}, tamperHash = false): string {
  const f: Record<string, string> = { status: "success", txnid: "txn1", mihpayid: "mp1", amount: "50.00", productinfo: "plan", firstname: "A", email: "a@example.org", ...over };
  const parts = [PAYU_SALT, f["status"], "", "", "", "", "", "", "", "", "", "", f["email"], f["firstname"], f["productinfo"], f["amount"], f["txnid"], PAYU_KEY];
  const hash = createHash("sha512").update(parts.join("|")).digest("hex");
  return new URLSearchParams({ ...f, hash: tamperHash ? hash.replace(/^./, hash[0] === "a" ? "b" : "a") : hash }).toString();
}

describe("POST /v1/billing/webhooks/payu", () => {
  it("accepts an anonymous callback carrying a valid reverse hash", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/billing/webhooks/payu", headers: { "content-type": "application/x-www-form-urlencoded" }, payload: payuForm() });
    expect(res.statusCode).toBe(200);
    expect(published).toHaveLength(1);
  });
  it("rejects a forged hash, a tampered amount and a missing hash", async () => {
    const h = { "content-type": "application/x-www-form-urlencoded" };
    expect((await app.inject({ method: "POST", url: "/v1/billing/webhooks/payu", headers: h, payload: payuForm({}, true) })).statusCode).toBe(401);
    const tampered = payuForm().replace("amount=50.00", "amount=1.00");
    expect((await app.inject({ method: "POST", url: "/v1/billing/webhooks/payu", headers: h, payload: tampered })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/billing/webhooks/payu", headers: h, payload: "status=success&txnid=t" })).statusCode).toBe(401);
    expect(published).toHaveLength(0);
  });
});

function encResp(plain: string, key: string): string {
  const iv = randomBytes(16);
  const c = createCipheriv("aes-128-cbc", createHash("md5").update(key).digest(), iv);
  return iv.toString("hex") + c.update(plain, "utf8", "hex") + c.final("hex");
}

describe("POST /v1/billing/webhooks/ccavenue", () => {
  const h = { "content-type": "application/x-www-form-urlencoded" };
  it("accepts an anonymous callback whose encResp decrypts under the working key", async () => {
    const body = new URLSearchParams({ encResp: encResp("order_id=o1&order_status=Success&amount=50.00", CCA_KEY) }).toString();
    const res = await app.inject({ method: "POST", url: "/v1/billing/webhooks/ccavenue", headers: h, payload: body });
    expect(res.statusCode).toBe(200);
    expect(published).toHaveLength(1);
  });
  it("rejects ciphertext under another key, garbage and a missing encResp", async () => {
    const wrong = new URLSearchParams({ encResp: encResp("order_id=o1&order_status=Success", rnd()) }).toString();
    expect((await app.inject({ method: "POST", url: "/v1/billing/webhooks/ccavenue", headers: h, payload: wrong })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/billing/webhooks/ccavenue", headers: h, payload: "encResp=zz" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/billing/webhooks/ccavenue", headers: h, payload: "x=1" })).statusCode).toBe(401);
    expect(published).toHaveLength(0);
  });
});

describe("dedupe by provider event id", () => {
  it("razorpay: a retried delivery (and a different x-razorpay-event-id header) carries the same messageId; a different event differs", async () => {
    const raw = JSON.stringify(rzpEvent());
    const send = (p: string, extra: Record<string, string> = {}) =>
      app.inject({ method: "POST", url: "/v1/billing/webhooks/razorpay", headers: { "content-type": "application/json", "x-razorpay-signature": rzpSig(p), ...extra }, payload: p });
    await send(raw);
    await send(raw, { "x-razorpay-event-id": rnd() });
    const other = JSON.stringify({ ...rzpEvent(), event: "payment.failed" });
    await send(other);
    expect(published).toHaveLength(3);
    expect(published[0]!.msg["messageId"]).toBe(published[1]!.msg["messageId"]);
    expect(published[2]!.msg["messageId"]).not.toBe(published[0]!.msg["messageId"]);
  });
  it("payu: same txnid+status dedupes, a different status does not", async () => {
    const h = { "content-type": "application/x-www-form-urlencoded" };
    for (const p of [payuForm(), payuForm(), payuForm({ status: "failure" })]) {
      await app.inject({ method: "POST", url: "/v1/billing/webhooks/payu", headers: h, payload: p });
    }
    expect(published).toHaveLength(3);
    expect(published[0]!.msg["messageId"]).toBe(published[1]!.msg["messageId"]);
    expect(published[2]!.msg["messageId"]).not.toBe(published[0]!.msg["messageId"]);
  });
  it("ccavenue: same decrypted order+status dedupes even though each ciphertext (random IV) differs", async () => {
    const h = { "content-type": "application/x-www-form-urlencoded" };
    for (const status of ["Success", "Success", "Failure"]) {
      const body = new URLSearchParams({ encResp: encResp(`order_id=o1&tracking_id=t1&order_status=${status}`, CCA_KEY) }).toString();
      await app.inject({ method: "POST", url: "/v1/billing/webhooks/ccavenue", headers: h, payload: body });
    }
    expect(published).toHaveLength(3);
    expect(published[0]!.msg["messageId"]).toBe(published[1]!.msg["messageId"]);
    expect(published[2]!.msg["messageId"]).not.toBe(published[0]!.msg["messageId"]);
  });
});
