/**
 * Owner decision sheet 2026-11-26, CRM items -- the HTTP behaviour against a real (disposable)
 * Postgres: C3 pipeline product = product code, C5 price-book masters + geography, C6 business
 * line master + lead attribute, C7 RTI authorities, C10 custom-field values + fail-closed PII.
 * Writes are CQRS: each PUT/POST answers 202 and the consumer applies it, so helpers drain the
 * queue before reading back.
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

function headers(roles: string[]) {
  const jwt = signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-dec-crm" }, SECRET);
  return { authorization: `Bearer ${jwt}`, "x-tenant-id": TENANT };
}

async function call(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, roles: string[], payload?: unknown) {
  const app = await buildApp();
  const res = await app.inject({ method, url, headers: headers(roles), ...(payload !== undefined ? { payload: payload as object } : {}) });
  await app.close();
  await drainQueue();
  return res;
}

async function inTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    return fn(tx as unknown as typeof sqlClient);
  }) as Promise<T>;
}

beforeAll(async () => {
  registerAllConsumers(queue);
  await queue.start();
});

afterAll(async () => {
  await sqlClient.end();
});

describe("C5 price-book segment / channel masters and geography", () => {
  it("is open while the masters are empty, then enforces the configured segment and channel", async () => {
    const open = await call("POST", "/v1/crm/price-books", ["crm_admin"], { name: "Open book", segment: "anything" });
    expect(open.statusCode).toBe(202);

    expect((await call("POST", "/v1/crm/price-book-segments", ["crm_admin"], { code: "government", label: "Government" })).statusCode).toBe(202);
    expect((await call("POST", "/v1/crm/price-book-channels", ["crm_admin"], { code: "direct", label: "Direct sales" })).statusCode).toBe(202);
    const segs = await call("GET", "/v1/crm/price-book-segments", ["crm_user"]);
    expect(segs.json().data.map((s: { code: string }) => s.code)).toEqual(["government"]);

    const bad = await call("POST", "/v1/crm/price-books", ["crm_admin"], { name: "Typo book", segment: "goverment" });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code).toBe("UNKNOWN_MASTER_VALUE");
    const badChannel = await call("POST", "/v1/crm/price-books", ["crm_admin"], { name: "Typo channel", channel: "retail" });
    expect(badChannel.statusCode).toBe(422);

    const good = await call("POST", "/v1/crm/price-books", ["crm_admin"], { name: "Gov book", segment: "Government", channel: "direct" });
    expect(good.statusCode).toBe(202);
    const list = (await call("GET", "/v1/crm/price-books", ["crm_user"])).json().data as Array<{ name: string; segment: string | null }>;
    expect(list.find((b) => b.name === "Gov book")?.segment).toBe("government"); // canonicalised to the master code
  });

  it("only a CRM admin can edit a master", async () => {
    expect((await call("POST", "/v1/crm/price-book-segments", ["crm_user"], { code: "x", label: "X" })).statusCode).toBe(403);
  });

  it("geography must be an Indian state / UT (code or name) and is stored as the code", async () => {
    const bad = await call("POST", "/v1/crm/price-books", ["crm_admin"], { name: "North book", geography: "north" });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code).toBe("UNKNOWN_GEOGRAPHY");
    const ok = await call("POST", "/v1/crm/price-books", ["crm_admin"], { name: "Odisha book", geography: "Odisha" });
    expect(ok.statusCode).toBe(202);
    const list = (await call("GET", "/v1/crm/price-books", ["crm_user"])).json().data as Array<{ name: string; geography: string | null }>;
    expect(list.find((b) => b.name === "Odisha book")?.geography).toBe("OD");
  });
});

describe("C3 pipeline product scope is the product code", () => {
  const stages = ["Qualify", "Propose", "Close"].map((name, ordinal) => ({ id: randomUUID(), name, probability: 20 + ordinal * 30, ordinal }));

  it("refuses a product that is not a catalogue code", async () => {
    const res = await call("POST", "/v1/crm/pipelines", ["crm_admin"], { name: "Scoped", stages, product: "Learning Platform" });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("UNKNOWN_PRODUCT_CODE");
  });

  it("keeps a legacy name-scoped pipeline editable: only a CHANGED product is validated", async () => {
    const created = await call("POST", "/v1/crm/pipelines", ["crm_admin"], { name: "Legacy scoped", stages });
    expect(created.statusCode).toBe(202);
    await inTenant((tx) => tx`UPDATE crm.pipelines SET product = 'Learning Platform' WHERE tenant_id = ${TENANT} AND name = 'Legacy scoped'`);
    const id = created.json().id as string;
    const version = (await call("GET", `/v1/crm/pipelines/${id}`, ["crm_user"])).json().data.version as number;

    const unchanged = await call("PATCH", `/v1/crm/pipelines/${id}`, ["crm_admin"], { name: "Legacy scoped 2", product: "Learning Platform", version });
    expect(unchanged.statusCode).toBe(202);
    const changed = await call("PATCH", `/v1/crm/pipelines/${id}`, ["crm_admin"], { product: "Some Other Name", version });
    expect(changed.statusCode).toBe(422);
    expect(changed.json().code).toBe("UNKNOWN_PRODUCT_CODE");
  });

  it("accepts an existing catalogue product code", async () => {
    expect((await call("POST", "/v1/crm/products", ["crm_admin"], { code: "LMS-01", name: "Learning Platform", priceMinor: "100000" })).statusCode).toBe(202);
    const res = await call("POST", "/v1/crm/pipelines", ["crm_admin"], { name: "LMS pipeline", stages, product: "LMS-01" });
    expect(res.statusCode).toBe(202);
  });
});

describe("C6 business-line master and the lead business line", () => {
  it("enforces the configured master on a lead and on a qualification framework", async () => {
    expect((await call("POST", "/v1/crm/business-lines", ["crm_admin"], { code: "government", label: "Government" })).statusCode).toBe(202);
    const bad = await call("POST", "/v1/crm/contacts", ["crm_user"], { name: "Asha Rao", leadSource: "web", businessLine: "goverment" });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code).toBe("UNKNOWN_MASTER_VALUE");
    const ok = await call("POST", "/v1/crm/contacts", ["crm_user"], { name: "Asha Rao", leadSource: "web", businessLine: "Government" });
    expect(ok.statusCode).toBe(202);
    const rows = await inTenant((tx) => tx`SELECT business_line FROM crm.contacts WHERE tenant_id = ${TENANT} AND name = 'Asha Rao'`);
    expect(rows[0]?.business_line).toBe("government");

    const fw = await call("POST", "/v1/crm/qualification-frameworks", ["crm_admin"], {
      name: "Typo framework", businessLine: "psu", questions: [{ prompt: "Budget approved?", answerType: "bool", weight: 10 }],
    });
    expect(fw.statusCode).toBe(422);
    const okFw = await call("POST", "/v1/crm/qualification-frameworks", ["crm_admin"], {
      name: "Gov framework", businessLine: "Government", questions: [{ prompt: "Budget approved?", answerType: "bool", weight: 10 }],
    });
    expect(okFw.statusCode).toBe(201);
    expect(okFw.json().data.businessLine).toBe("government");
  });
});

describe("C7 RTI public authorities", () => {
  it("lists the 7 built-in central bodies for a tenant with an empty register", async () => {
    const res = await call("GET", "/v1/crm/rti/authorities", ["crm_user"]);
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(7);
    expect(res.json().data[0]).toEqual({ name: "Ministry of Finance", source: "built_in" });
  });
});

describe("C10 custom fields: fail-closed PII and the value store", () => {
  it("refuses an Aadhaar / PAN field unless it is sensitive:true", async () => {
    for (const validationSchema of [{ sensitive: false }, {}, null]) {
      const res = await call("POST", "/v1/crm/custom-fields", ["crm_admin"], { entityType: "contacts", fieldName: "Aadhaar number", fieldType: "text", validationSchema });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("SENSITIVE_FIELD_REQUIRED");
    }
    const pan = await call("POST", "/v1/crm/custom-fields", ["crm_admin"], { entityType: "contacts", fieldName: "PAN", fieldType: "text", validationSchema: { sensitive: false } });
    expect(pan.statusCode).toBe(422);
  });

  it("refuses concatenated identifier names on create AND on update (effective name)", async () => {
    for (const fieldName of ["aadhaarnumber", "aadhaar1", "pancard", "passportno"]) {
      const res = await call("POST", "/v1/crm/custom-fields", ["crm_admin"], { entityType: "leads", fieldName, fieldType: "text", validationSchema: { sensitive: false } });
      expect(res.statusCode, fieldName).toBe(422);
    }
    expect((await call("POST", "/v1/crm/custom-fields", ["crm_admin"], { entityType: "leads", fieldName: "Referrer note", fieldType: "text" })).statusCode).toBe(202);
    const defs = (await call("GET", "/v1/crm/custom-fields/leads", ["crm_user"])).json().data as Array<{ id: string; fieldName: string }>;
    const id = defs.find((d) => d.fieldName === "Referrer note")!.id;
    for (const fieldName of ["aadhaarnumber", "pancard"]) {
      const res = await call("PATCH", `/v1/crm/custom-fields/${id}`, ["crm_admin"], { fieldName });
      expect(res.statusCode, `rename to ${fieldName}`).toBe(422);
    }
  });

  it("stores values in crm.custom_field_values, encrypts sensitive ones and masks them for other roles", async () => {
    expect((await call("POST", "/v1/crm/custom-fields", ["crm_admin"], { entityType: "contacts", fieldName: "Aadhaar number", fieldType: "text", validationSchema: { sensitive: true } })).statusCode).toBe(202);
    expect((await call("POST", "/v1/crm/custom-fields", ["crm_admin"], { entityType: "contacts", fieldName: "Industry", fieldType: "select", validationSchema: { options: ["health", "education"] } })).statusCode).toBe(202);
    const defs = (await call("GET", "/v1/crm/custom-fields/contacts", ["crm_user"])).json().data as Array<{ id: string; fieldName: string }>;
    const aadhaar = defs.find((d) => d.fieldName === "Aadhaar number")!;
    const industry = defs.find((d) => d.fieldName === "Industry")!;

    const contactId = randomUUID();
    await inTenant((tx) => tx`
      INSERT INTO crm.contacts (id, tenant_id, name, created_by, updated_by) VALUES (${contactId}, ${TENANT}, 'Meera Das', ${ACTOR}, ${ACTOR})`);

    const bad = await call("PUT", `/v1/crm/custom-field-values/contacts/${contactId}`, ["crm_user"], { values: { [industry.id]: "mining" } });
    expect(bad.statusCode).toBe(400);

    const put = await call("PUT", `/v1/crm/custom-field-values/contacts/${contactId}`, ["crm_admin"], {
      values: { [industry.id]: "health", [aadhaar.id]: "123412341234" },
    });
    expect(put.statusCode).toBe(202);

    const raw = await inTenant((tx) => tx`SELECT value::text AS v FROM crm.custom_field_values WHERE tenant_id = ${TENANT} AND entity_id = ${contactId}`);
    expect(raw).toHaveLength(2);
    expect(raw.map((r) => r.v).join("|")).not.toContain("123412341234"); // never stored in the clear

    const asAdmin = (await call("GET", `/v1/crm/custom-field-values/contacts/${contactId}`, ["crm_admin"])).json().data as Array<{ fieldName: string; value: unknown; masked: boolean }>;
    expect(asAdmin.find((f) => f.fieldName === "Aadhaar number")).toMatchObject({ value: "123412341234", masked: false });
    const asUser = (await call("GET", `/v1/crm/custom-field-values/contacts/${contactId}`, ["crm_user"])).json().data as Array<{ fieldName: string; value: unknown; masked: boolean }>;
    expect(asUser.find((f) => f.fieldName === "Aadhaar number")).toMatchObject({ value: null, masked: true });
    expect(asUser.find((f) => f.fieldName === "Industry")).toMatchObject({ value: "health", masked: false });

    const blind = await call("PUT", `/v1/crm/custom-field-values/contacts/${contactId}`, ["crm_user"], { values: { [aadhaar.id]: "999999999999" } });
    expect(blind.statusCode).toBe(403);

    const gone = await call("PUT", `/v1/crm/custom-field-values/contacts/${contactId}`, ["crm_admin"], { values: { [industry.id]: null } });
    expect(gone.statusCode).toBe(202);
    const left = await inTenant((tx) => tx`SELECT count(*)::int AS n FROM crm.custom_field_values WHERE tenant_id = ${TENANT} AND entity_id = ${contactId}`);
    expect(left[0]?.n).toBe(1);
  });
});

describe("C8 quotation discount is measured against the price-book price, default threshold applies", () => {
  it("warns on create and blocks the send above the default 10% when the tenant configured no threshold", async () => {
    expect((await call("POST", "/v1/crm/products", ["crm_admin"], { code: "QP-8", name: "Training seat", priceMinor: "200000" })).statusCode).toBe(202);
    const products = (await call("GET", "/v1/crm/products", ["crm_user"])).json().data as Array<{ id: string; code: string }>;
    const productId = products.find((p) => p.code === "QP-8")!.id;
    // price book 1,000.00 (catalogue says 2,000.00): the BOOK is the reference.
    const book = await call("POST", "/v1/crm/price-books", ["crm_admin"], { name: "General INR", entries: [{ productId, priceMinor: "100000" }] });
    expect(book.statusCode).toBe(202);

    const created = await call("POST", "/v1/crm/quotations", ["crm_user"], {
      quoteRef: `Q-C8-${randomUUID().slice(0, 8)}`, templateRef: "standard",
      lineItems: [{ productId, description: "Training seat", quantity: 1, unitPriceMinor: "50000", taxRateBps: 0 }],
    });
    expect(created.statusCode).toBe(202);
    const warn = created.json().data?.warnings?.[0];
    expect(warn).toMatchObject({ code: "DISCOUNT_ABOVE_THRESHOLD", discountBps: 5000, thresholdBps: 1000, thresholdSource: "default" });

    const sent = await call("POST", `/v1/crm/quotations/${created.json().id}/send`, ["crm_user"]);
    expect(sent.statusCode).toBe(422);
    expect(sent.json().code).toBe("APPROVAL_REQUIRED");
  });

  it("a quote at the price-book price carries no warning and can be sent", async () => {
    const products = (await call("GET", "/v1/crm/products", ["crm_user"])).json().data as Array<{ id: string; code: string }>;
    const productId = products.find((p) => p.code === "QP-8")!.id;
    const created = await call("POST", "/v1/crm/quotations", ["crm_user"], {
      quoteRef: `Q-C8-${randomUUID().slice(0, 8)}`, templateRef: "standard",
      lineItems: [{ productId, description: "Training seat", quantity: 1, unitPriceMinor: "100000", taxRateBps: 0 }],
    });
    expect(created.statusCode).toBe(202);
    expect(created.json().data?.warnings).toBeUndefined();
    const sent = await call("POST", `/v1/crm/quotations/${created.json().id}/send`, ["crm_user"]);
    expect(sent.statusCode).toBe(202);
  });
});
