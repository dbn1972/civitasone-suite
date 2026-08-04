/**
 * LM-002 — PUBLIC, UNAUTHENTICATED lead capture.
 *
 * The acceptance criterion is "Submitted data creates or updates a lead and records
 * attribution", so the central test here is a round-trip: POST the form, drain the bus,
 * then read the contact row back OUT OF POSTGRES and assert every attribution column.
 * A 202 that leaves no row, or a row with null attribution, is a failure — and is
 * exactly the failure CQRS makes easy to ship, because the route answers 202 whether or
 * not anything downstream works.
 *
 * The rest is the security surface of the one anonymous write in this service: rate
 * limiting in both dimensions, origin allow-listing, consent, enumeration resistance,
 * input bounds and tenant isolation.
 *
 * Tenant ids are per-run (`randomUUID()`), forms are seeded per test so their rate-limit
 * counters cannot bleed between cases, and every messageId is random — nothing here
 * poisons `_inbox.processed`.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue, cache } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue, captureHandlers, envelope } from "./consumer-harness.js";
import { blindIndex } from "../src/shared/pii-crypto.js";
import { COMMANDS } from "../src/topics.js";
import * as formsRepo from "../src/modules/leads/capture-forms-repo.js";
import {
  resolveClientIp,
  checkCaptureRateLimit,
} from "../src/modules/leads/public-capture-rate-limit.js";
import {
  submissionIdentity,
  originAllowed,
  DEFAULT_PUBLIC_LEAD_SOURCE,
} from "../src/modules/leads/public-routes.js";

// Without a PII key the encrypted-column path fails closed, so the capture consumer
// dead-letters and the 202 leaves no row — which looks like a broken feature rather than
// missing configuration.
process.env.CRM_PII_KEY ??= "test_pii_key_for_crm_domain_tests_aaaa";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();

const PUBLIC_URL = (formKey: string): string => `/v1/crm/public/leads/${formKey}`;

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];

/** Read/write as the service does: inside a tx with the RLS GUC set. */
function scoped<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

/**
 * The in-memory bus captures a failed delivery to its DLQ instead of throwing, so a
 * broken consumer looks exactly like a slow one.
 */
function dlqErrors(): string[] {
  return ((queue as unknown as { dlq?: Array<{ topic: string; error: string }> }).dlq ?? [])
    .map((d) => `${d.topic}: ${d.error}`);
}

interface SeedFormOptions {
  tenantId?: string;
  enabled?: boolean;
  requireConsent?: boolean;
  allowedOrigins?: string[];
  defaultLeadSource?: string | null;
  campaignId?: string | null;
  maxPerMinute?: number;
}

/**
 * Seed a form straight into Postgres rather than through the admin route: these tests
 * are about the PUBLIC path, and a per-test form guarantees a fresh rate-limit window
 * (the counters are keyed on the form key).
 */
async function seedForm(opts: SeedFormOptions = {}): Promise<{ id: string; formKey: string; tenantId: string }> {
  const tenantId = opts.tenantId ?? TENANT;
  const id = randomUUID();
  const formKey = formsRepo.generateFormKey();
  await scoped(
    tenantId,
    (tx) => tx`
      INSERT INTO crm.lead_capture_forms
        (id, tenant_id, form_key, name, enabled, require_consent, allowed_origins,
         default_lead_source, campaign_id, max_per_minute, created_by, updated_by)
      VALUES (
        ${id}, ${tenantId}, ${formKey}, ${`seed-${id.slice(0, 8)}`},
        ${opts.enabled ?? true}, ${opts.requireConsent ?? false},
        ${JSON.stringify(opts.allowedOrigins ?? [])}::jsonb,
        ${opts.defaultLeadSource ?? null}, ${opts.campaignId ?? null},
        ${opts.maxPerMinute ?? 100}, ${ACTOR}, ${ACTOR}
      )
    `,
  );
  return { id, formKey, tenantId };
}

interface SubmitOptions {
  origin?: string;
  forwardedFor?: string;
  headers?: Record<string, string>;
}

async function submit(formKey: string, payload: unknown, opts: SubmitOptions = {}) {
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: PUBLIC_URL(formKey),
    headers: {
      ...(opts.origin !== undefined ? { origin: opts.origin } : {}),
      ...(opts.forwardedFor !== undefined ? { "x-forwarded-for": opts.forwardedFor } : {}),
      ...opts.headers,
    },
    payload: payload as never,
  });
  await app.close();
  await drainQueue();
  return res;
}

interface StoredLead {
  id: string;
  name: string;
  emailIdx: string | null;
  company: string | null;
  city: string | null;
  designation: string | null;
  leadStatus: string;
  leadSource: string | null;
  marketingConsent: boolean;
  consentDate: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  campaignId: string | null;
  captureFormId: string | null;
  version: number;
}

/** What is actually on disk. `consent_date` is cast to text so the assertion is exact. */
async function leadsForForm(formId: string, tenantId: string = TENANT): Promise<StoredLead[]> {
  return (await scoped(
    tenantId,
    (tx) => tx`
      SELECT id, name,
             email_idx         AS "emailIdx",
             company, city, designation,
             lead_status       AS "leadStatus",
             lead_source       AS "leadSource",
             marketing_consent AS "marketingConsent",
             consent_date::text AS "consentDate",
             utm_source        AS "utmSource",
             utm_medium        AS "utmMedium",
             utm_campaign      AS "utmCampaign",
             utm_term          AS "utmTerm",
             utm_content       AS "utmContent",
             campaign_id       AS "campaignId",
             capture_form_id   AS "captureFormId",
             version
      FROM crm.contacts
      WHERE tenant_id = ${tenantId} AND capture_form_id = ${formId}
      ORDER BY created_at
    `,
  )) as unknown as StoredLead[];
}

/** Clear every rate-limit counter. They are namespaced under the literal "public" tenant. */
async function clearRateLimits(): Promise<void> {
  await cache.invalidateResource("public", "public_capture_rl");
}

async function cleanup(): Promise<void> {
  for (const tenantId of [TENANT, OTHER_TENANT]) {
    await scoped(tenantId, (tx) => tx`DELETE FROM crm.contacts WHERE tenant_id = ${tenantId}`);
    await scoped(
      tenantId,
      (tx) => tx`DELETE FROM crm.lead_capture_forms WHERE tenant_id = ${tenantId}`,
    );
    await cache.invalidateResource(tenantId, formsRepo.RESOURCE);
    await cache.invalidateResource(tenantId, "contact");
  }
  await clearRateLimits();
}

beforeAll(async () => {
  registerAllConsumers(queue);
  await queue.start();
  await cleanup();
});

afterEach(() => {
  // Several cases set these to exercise the trusted-hop and tenant-ceiling behaviour;
  // leaking them into the next case would change how a client IP is derived.
  delete process.env.TRUSTED_PROXY_HOPS;
  delete process.env.CRM_PUBLIC_CAPTURE_TENANT_MAX_PER_MINUTE;
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

// ── THE acceptance criterion: attribution round-trip ────────────────────────────

describe("attribution round-trip (LM-002 acceptance criterion)", () => {
  it("persists every UTM parameter, the campaign, the source and the consent", async () => {
    const campaignId = randomUUID();
    const form = await seedForm({ requireConsent: true, defaultLeadSource: "website" });

    const res = await submit(form.formKey, {
      name: "Jane Prospect",
      email: "jane.prospect@example.gov.in",
      phone: "+91 98765 43210",
      company: "Acme Corp",
      city: "Pune",
      designation: "Director",
      consent: true,
      source: "google_ads",
      campaignId,
      utm: {
        source: "google",
        medium: "cpc",
        campaign: "monsoon-2026",
        term: "erp for government",
        content: "banner-a",
      },
    });

    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: "accepted", correlationId: expect.any(String) });

    const rows = await leadsForForm(form.id);
    expect(
      rows,
      `a 202 that leaves no row is a silent write failure; dlq=${JSON.stringify(dlqErrors())}`,
    ).toHaveLength(1);
    const lead = rows[0]!;

    // Attribution — the substance of "records attribution".
    expect(lead.utmSource).toBe("google");
    expect(lead.utmMedium).toBe("cpc");
    expect(lead.utmCampaign).toBe("monsoon-2026");
    expect(lead.utmTerm).toBe("erp for government");
    expect(lead.utmContent).toBe("banner-a");
    expect(lead.campaignId).toBe(campaignId);
    expect(lead.captureFormId).toBe(form.id);
    // The submission's own `source` wins over the form's default.
    expect(lead.leadSource).toBe("google_ads");

    // Consent (DPDP Act 2023), with a SERVER-derived date.
    expect(lead.marketingConsent).toBe(true);
    expect(lead.consentDate).toBe(new Date().toISOString().slice(0, 10));

    // Identity, and PII stored through the encrypted column + blind index.
    expect(lead.name).toBe("Jane Prospect");
    expect(lead.emailIdx).toBe(blindIndex("jane.prospect@example.gov.in"));

    // The anonymous path must land PII in the SAME encrypted columns as every other
    // contact — not a plaintext shortcut because the writer happened to be a web form.
    const raw = (await scoped(
      TENANT,
      (tx) => tx`SELECT email, phone FROM crm.contacts WHERE id = ${lead.id}`,
    )) as unknown as Array<{ email: string; phone: string }>;
    expect(raw[0]?.email.startsWith("enc:v2:")).toBe(true);
    expect(raw[0]?.phone.startsWith("enc:v2:")).toBe(true);
    expect(raw[0]?.email).not.toContain("jane.prospect");
    expect(lead.company).toBe("Acme Corp");
    expect(lead.city).toBe("Pune");
    expect(lead.designation).toBe("Director");
    expect(lead.leadStatus).toBe("new");
  });

  it("falls back to the form's default lead source, then to the generic label", async () => {
    const withDefault = await seedForm({ defaultLeadSource: "microsite" });
    await submit(withDefault.formKey, { name: "Default Source", email: `d-${randomUUID()}@x.in` });
    expect((await leadsForForm(withDefault.id))[0]?.leadSource).toBe("microsite");

    const without = await seedForm();
    await submit(without.formKey, { name: "No Source", email: `n-${randomUUID()}@x.in` });
    expect((await leadsForForm(without.id))[0]?.leadSource).toBe(DEFAULT_PUBLIC_LEAD_SOURCE);
  });

  it("uses the form's campaign when the submission does not name one", async () => {
    const campaignId = randomUUID();
    const form = await seedForm({ campaignId });
    await submit(form.formKey, { name: "Form Campaign", email: `fc-${randomUUID()}@x.in` });
    expect((await leadsForForm(form.id))[0]?.campaignId).toBe(campaignId);
  });

  it("leaves attribution NULL rather than inventing it when nothing was supplied", async () => {
    const form = await seedForm();
    await submit(form.formKey, { name: "Bare Lead", email: `b-${randomUUID()}@x.in` });
    const lead = (await leadsForForm(form.id))[0]!;
    // A placeholder like 'unknown' would corrupt campaign ROI reporting.
    expect(lead.utmSource).toBeNull();
    expect(lead.utmCampaign).toBeNull();
    expect(lead.campaignId).toBeNull();
    // ...but lead_source is always set, so every row can be attributed to a channel.
    expect(lead.leadSource).toBe(DEFAULT_PUBLIC_LEAD_SOURCE);
  });
});

// ── Create-or-update ───────────────────────────────────────────────────────────

describe("create-or-update on the tenant's email index", () => {
  it("updates the existing lead and its attribution instead of duplicating it", async () => {
    const form = await seedForm();
    const email = `returning-${randomUUID()}@example.gov.in`;

    await submit(form.formKey, {
      name: "First Visit",
      email,
      utm: { source: "google", campaign: "spring" },
    });
    const first = await leadsForForm(form.id);
    expect(first).toHaveLength(1);

    await submit(form.formKey, {
      name: "Second Visit",
      email,
      company: "New Employer",
      utm: { source: "linkedin", campaign: "monsoon", medium: "social" },
    });

    const rows = await leadsForForm(form.id);
    expect(rows, "the same prospect must not become two leads").toHaveLength(1);
    const lead = rows[0]!;
    expect(lead.id).toBe(first[0]!.id);
    // Newest submission = newest attribution.
    expect(lead.utmSource).toBe("linkedin");
    expect(lead.utmCampaign).toBe("monsoon");
    expect(lead.utmMedium).toBe("social");
    expect(lead.name).toBe("Second Visit");
    expect(lead.company).toBe("New Employer");
    expect(lead.version).toBeGreaterThan(first[0]!.version);
  });

  it("matches on the email index regardless of casing or surrounding whitespace", async () => {
    const form = await seedForm();
    const local = `mixed-${randomUUID()}`;
    await submit(form.formKey, { name: "Lower", email: `${local}@example.gov.in` });
    await submit(form.formKey, { name: "Upper", email: ` ${local.toUpperCase()}@EXAMPLE.GOV.IN ` });
    expect(await leadsForForm(form.id)).toHaveLength(1);
  });

  it("converges a phone-only prospect on one row via the deterministic contact id", async () => {
    const form = await seedForm();
    const phone = "+91 90000 12345";
    await submit(form.formKey, { name: "Phone Only", phone, utm: { source: "print" } });
    // Same number, different formatting — `submissionIdentity` normalises to digits.
    await submit(form.formKey, { name: "Phone Only", phone: "+919000012345", utm: { source: "radio" } });

    const rows = await leadsForForm(form.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.utmSource).toBe("radio");
  });

  it("does NOT downgrade lead_status on update — sales work is not discarded", async () => {
    const form = await seedForm();
    const email = `qualified-${randomUUID()}@example.gov.in`;
    await submit(form.formKey, { name: "Qualified Lead", email });

    const id = (await leadsForForm(form.id))[0]!.id;
    await scoped(
      TENANT,
      (tx) => tx`UPDATE crm.contacts SET lead_status = 'qualified' WHERE id = ${id}`,
    );

    await submit(form.formKey, { name: "Qualified Lead", email, utm: { source: "retarget" } });
    const lead = (await leadsForForm(form.id))[0]!;
    expect(lead.leadStatus).toBe("qualified");
    expect(lead.utmSource).toBe("retarget");
  });

  it("does not revoke consent already given when a later submission does not ask for it", async () => {
    const form = await seedForm({ requireConsent: false });
    const email = `consented-${randomUUID()}@example.gov.in`;
    await submit(form.formKey, { name: "Consenting", email, consent: true });
    expect((await leadsForForm(form.id))[0]?.marketingConsent).toBe(true);

    await submit(form.formKey, { name: "Consenting", email, utm: { source: "later" } });
    const lead = (await leadsForForm(form.id))[0]!;
    // Withdrawal is its own audited action, not a side effect of a web form.
    expect(lead.marketingConsent).toBe(true);
    expect(lead.consentDate).not.toBeNull();
  });

  it("keeps two tenants' leads apart even for the same email address", async () => {
    const email = `shared-${randomUUID()}@example.gov.in`;
    const a = await seedForm();
    const b = await seedForm({ tenantId: OTHER_TENANT });

    await submit(a.formKey, { name: "Tenant A Lead", email, utm: { source: "a" } });
    await submit(b.formKey, { name: "Tenant B Lead", email, utm: { source: "b" } });

    const rowsA = await leadsForForm(a.id, TENANT);
    const rowsB = await leadsForForm(b.id, OTHER_TENANT);
    expect(rowsA).toHaveLength(1);
    expect(rowsB).toHaveLength(1);
    expect(rowsA[0]?.utmSource).toBe("a");
    expect(rowsB[0]?.utmSource).toBe("b");
    expect(rowsA[0]?.id).not.toBe(rowsB[0]?.id);
  });
});

// ── Consent ────────────────────────────────────────────────────────────────────

describe("consent enforcement (DPDP Act 2023)", () => {
  it("refuses 422 and writes nothing when the form requires consent and none was given", async () => {
    const form = await seedForm({ requireConsent: true });
    const res = await submit(form.formKey, { name: "No Consent", email: `nc-${randomUUID()}@x.in` });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("CONSENT_REQUIRED");
    expect(await leadsForForm(form.id)).toHaveLength(0);
  });

  it("refuses 422 for an explicit consent: false", async () => {
    const form = await seedForm({ requireConsent: true });
    const res = await submit(form.formKey, {
      name: "Declined",
      email: `dc-${randomUUID()}@x.in`,
      consent: false,
    });
    expect(res.statusCode).toBe(422);
    expect(await leadsForForm(form.id)).toHaveLength(0);
  });

  it("records consent as false, with no date, when the form does not require it", async () => {
    const form = await seedForm({ requireConsent: false });
    await submit(form.formKey, { name: "Silent", email: `si-${randomUUID()}@x.in` });
    const lead = (await leadsForForm(form.id))[0]!;
    // Absence of consent, not consent.
    expect(lead.marketingConsent).toBe(false);
    expect(lead.consentDate).toBeNull();
  });

  it("rejects a client-supplied consentDate — the server stamps it, or nobody does", async () => {
    const form = await seedForm({ requireConsent: true });
    const res = await submit(form.formKey, {
      name: "Backdated",
      email: `bd-${randomUUID()}@x.in`,
      consent: true,
      consentDate: "2001-01-01",
    });
    expect(res.statusCode).toBe(400);
    expect(await leadsForForm(form.id)).toHaveLength(0);
  });
});

// ── Rate limiting ──────────────────────────────────────────────────────────────

describe("rate limiting", () => {
  it("returns 429 once a form's per-IP budget is spent", async () => {
    // Earlier cases in this file have already charged the tenant counter for this
    // minute, so start from a clean window or the assertion measures the wrong budget.
    await clearRateLimits();
    const form = await seedForm({ maxPerMinute: 2 });
    for (let i = 0; i < 2; i += 1) {
      const ok = await submit(form.formKey, { name: `Burst ${i}`, email: `burst${i}-${randomUUID()}@x.in` });
      expect(ok.statusCode).toBe(202);
    }
    const blocked = await submit(form.formKey, { name: "Too much", email: `tm-${randomUUID()}@x.in` });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json().code).toBe("RATE_LIMITED");
    expect(await leadsForForm(form.id)).toHaveLength(2);
  });

  it("gives each client IP its own budget — one abuser cannot lock out a tenant", async () => {
    // The per-IP dimension only exists if the client IP can be told apart, which behind
    // the gateway means trusting exactly one x-forwarded-for hop.
    process.env.TRUSTED_PROXY_HOPS = "1";
    await clearRateLimits();
    const form = await seedForm({ maxPerMinute: 1 });

    const first = await submit(form.formKey, { name: "IP A", email: `ipa-${randomUUID()}@x.in` }, { forwardedFor: "203.0.113.10" });
    expect(first.statusCode).toBe(202);
    const abuser = await submit(form.formKey, { name: "IP A again", email: `ipa2-${randomUUID()}@x.in` }, { forwardedFor: "203.0.113.10" });
    expect(abuser.statusCode).toBe(429);

    // A different prospect, same form, same minute: unaffected by the abuser's overage.
    const other = await submit(form.formKey, { name: "IP B", email: `ipb-${randomUUID()}@x.in` }, { forwardedFor: "203.0.113.99" });
    expect(other.statusCode).toBe(202);
  });

  it("enforces a tenant-wide ceiling that rotating IPs cannot dodge", async () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    process.env.CRM_PUBLIC_CAPTURE_TENANT_MAX_PER_MINUTE = "2";
    await clearRateLimits();
    const form = await seedForm({ maxPerMinute: 1 });

    for (const ip of ["198.51.100.1", "198.51.100.2"]) {
      const ok = await submit(form.formKey, { name: `Flood ${ip}`, email: `f${ip}-${randomUUID()}@x.in` }, { forwardedFor: ip });
      expect(ok.statusCode).toBe(202);
    }
    // Third distinct IP: its own per-IP budget is untouched, but the tenant ceiling is spent.
    const blocked = await submit(form.formKey, { name: "Flood 3", email: `f3-${randomUUID()}@x.in` }, { forwardedFor: "198.51.100.3" });
    expect(blocked.statusCode).toBe(429);
  });

  it("does not let a refused IP consume the tenant's shared budget", async () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    process.env.CRM_PUBLIC_CAPTURE_TENANT_MAX_PER_MINUTE = "3";
    await clearRateLimits();
    const form = await seedForm({ maxPerMinute: 1 });

    await submit(form.formKey, { name: "Abuser", email: `ab-${randomUUID()}@x.in` }, { forwardedFor: "192.0.2.1" });
    // Five refusals from the same IP. If a per-IP refusal still charged the tenant
    // counter, these would burn the ceiling and deny everyone else.
    for (let i = 0; i < 5; i += 1) {
      const refused = await submit(form.formKey, { name: "Abuser", email: `ab${i}-${randomUUID()}@x.in` }, { forwardedFor: "192.0.2.1" });
      expect(refused.statusCode).toBe(429);
    }
    for (const ip of ["192.0.2.50", "192.0.2.51"]) {
      const ok = await submit(form.formKey, { name: "Genuine", email: `g${ip}-${randomUUID()}@x.in` }, { forwardedFor: ip });
      expect(ok.statusCode).toBe(202);
    }
  });

  it("fails CLOSED when the limiter backend is unavailable", async () => {
    const form = await seedForm({ maxPerMinute: 10 });
    const broken = vi.spyOn(cache, "getOrLoad").mockRejectedValue(new Error("redis unavailable"));
    try {
      const res = await submit(form.formKey, { name: "Redis down", email: `rd-${randomUUID()}@x.in` });
      // An unauthenticated write must not degrade OPEN: a cache outage would otherwise
      // become an unbounded insert loop.
      expect(res.statusCode).toBe(429);
      expect(res.json().message).toContain("temporarily unavailable");
    } finally {
      broken.mockRestore();
    }
    expect(await leadsForForm(form.id)).toHaveLength(0);
  });

  it("counts within a fixed window that rolls over rather than being extended", async () => {
    const target = {
      formKey: formsRepo.generateFormKey(),
      tenantId: TENANT,
      clientIp: "203.0.113.7",
      maxPerMinute: 1,
    };
    const t0 = 1_800_000_000_000;
    expect((await checkCaptureRateLimit(target, t0)).allowed).toBe(true);
    expect((await checkCaptureRateLimit(target, t0 + 1_000)).allowed).toBe(false);
    // Next minute bucket is a different key, so sustained traffic cannot pin the
    // counter open and lock a form out permanently.
    expect((await checkCaptureRateLimit(target, t0 + 61_000)).allowed).toBe(true);
  });
});

// ── x-forwarded-for trust ──────────────────────────────────────────────────────

describe("resolveClientIp", () => {
  const req = (xff?: string | string[]) => ({
    ip: "10.0.0.1",
    headers: xff === undefined ? {} : { "x-forwarded-for": xff },
  }) as Parameters<typeof resolveClientIp>[0];

  it("ignores x-forwarded-for entirely by default", () => {
    // A service accidentally exposed without a proxy in front must not honour a
    // self-declared IP.
    expect(resolveClientIp(req("1.2.3.4"))).toBe("10.0.0.1");
  });

  it("takes the LAST hop when one proxy is trusted, so a spoofed prefix is ignored", () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    // The client sent "1.2.3.4"; the gateway appended what it actually observed.
    expect(resolveClientIp(req("1.2.3.4, 203.0.113.5"))).toBe("203.0.113.5");
  });

  it("steps back one entry per trusted hop", () => {
    process.env.TRUSTED_PROXY_HOPS = "2";
    expect(resolveClientIp(req("1.2.3.4, 203.0.113.5, 10.1.1.1"))).toBe("203.0.113.5");
  });

  it("clamps when fewer hops are present than configured", () => {
    process.env.TRUSTED_PROXY_HOPS = "5";
    expect(resolveClientIp(req("203.0.113.5"))).toBe("203.0.113.5");
  });

  it("falls back to the socket peer when the header is absent or empty", () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    expect(resolveClientIp(req())).toBe("10.0.0.1");
    expect(resolveClientIp(req("   "))).toBe("10.0.0.1");
    expect(resolveClientIp(req(", ,"))).toBe("10.0.0.1");
  });

  it("handles a repeated header the same as one comma-separated value", () => {
    process.env.TRUSTED_PROXY_HOPS = "1";
    expect(resolveClientIp(req(["1.2.3.4", "203.0.113.5"]))).toBe("203.0.113.5");
  });

  it("ignores a non-numeric hop count rather than trusting the header", () => {
    process.env.TRUSTED_PROXY_HOPS = "yes-please";
    expect(resolveClientIp(req("1.2.3.4"))).toBe("10.0.0.1");
  });
});

// ── Origin allow-listing ───────────────────────────────────────────────────────

describe("origin allow-listing", () => {
  it("accepts a submission from an allow-listed origin", async () => {
    const form = await seedForm({ allowedOrigins: ["https://www.example.gov.in"] });
    const res = await submit(
      form.formKey,
      { name: "Allowed", email: `al-${randomUUID()}@x.in` },
      { origin: "https://www.example.gov.in" },
    );
    expect(res.statusCode).toBe(202);
    expect(await leadsForForm(form.id)).toHaveLength(1);
  });

  it("rejects an origin that is not on the list", async () => {
    const form = await seedForm({ allowedOrigins: ["https://www.example.gov.in"] });
    const res = await submit(
      form.formKey,
      { name: "Evil", email: `ev-${randomUUID()}@x.in` },
      { origin: "https://evil.example.com" },
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("ORIGIN_NOT_ALLOWED");
    expect(await leadsForForm(form.id)).toHaveLength(0);
  });

  it("rejects a request with NO origin once an allowlist is configured", async () => {
    const form = await seedForm({ allowedOrigins: ["https://www.example.gov.in"] });
    const res = await submit(form.formKey, { name: "No origin", email: `no-${randomUUID()}@x.in` });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a near-miss subdomain — matching is exact, never a suffix", () => {
    expect(originAllowed(["https://example.gov.in"], "https://evil-example.gov.in")).toBe(false);
    expect(originAllowed(["https://example.gov.in"], "https://sub.example.gov.in")).toBe(false);
    expect(originAllowed(["https://example.gov.in"], "http://example.gov.in")).toBe(false);
    expect(originAllowed(["https://example.gov.in"], "https://example.gov.in")).toBe(true);
  });

  it("treats an empty allowlist as 'any origin' — a server-side post sends none", () => {
    expect(originAllowed([], undefined)).toBe(true);
    expect(originAllowed([], "https://anything.example")).toBe(true);
  });
});

// ── Enumeration resistance ─────────────────────────────────────────────────────

describe("no tenant enumeration", () => {
  /** Everything an anonymous caller can observe, minus the per-request correlation id. */
  function shape(res: { statusCode: number; json: () => { code: string; message: string } }) {
    const body = res.json();
    return { statusCode: res.statusCode, code: body.code, message: body.message };
  }

  it("answers identically for unknown, malformed, disabled and deleted form keys", async () => {
    const disabled = await seedForm({ enabled: false });
    const deleted = await seedForm();
    await scoped(
      TENANT,
      (tx) => tx`DELETE FROM crm.lead_capture_forms WHERE id = ${deleted.id}`,
    );

    const payload = { name: "Probe", email: `pr-${randomUUID()}@x.in` };
    const responses = [
      shape(await submit(formsRepo.generateFormKey(), payload)), // never existed
      shape(await submit(disabled.formKey, payload)), // exists, switched off
      shape(await submit(deleted.formKey, payload)), // existed, removed
      shape(await submit("not-a-form-key", payload)), // malformed
      shape(await submit("A".repeat(64), payload)), // right length, wrong alphabet
    ];

    // Byte-identical: status, code and message. A scanner learns nothing about which
    // keys — and therefore which tenants — exist.
    for (const r of responses) {
      expect(r).toEqual({ statusCode: 404, code: "NOT_FOUND", message: "form not found" });
    }
    expect(await leadsForForm(disabled.id)).toHaveLength(0);
  });

  it("does not reveal that a key belongs to another tenant", async () => {
    const other = await seedForm({ tenantId: OTHER_TENANT });
    // There is no code path that could distinguish "not yours" from "not there": the key
    // IS the tenant resolver, so a valid key simply writes into ITS tenant...
    const res = await submit(other.formKey, { name: "Cross", email: `cr-${randomUUID()}@x.in` });
    expect(res.statusCode).toBe(202);
    // ...and never into the caller's assumed one.
    expect(await leadsForForm(other.id, OTHER_TENANT)).toHaveLength(1);
    expect(await leadsForForm(other.id, TENANT)).toHaveLength(0);
  });

  it("ignores headers that try to redirect the write to another tenant", async () => {
    const form = await seedForm();
    const res = await submit(
      form.formKey,
      { name: "Header Spoof", email: `hs-${randomUUID()}@x.in` },
      { headers: { "x-tenant-id": OTHER_TENANT } },
    );
    expect(res.statusCode).toBe(202);
    expect(await leadsForForm(form.id, TENANT)).toHaveLength(1);
    expect(await leadsForForm(form.id, OTHER_TENANT)).toHaveLength(0);
  });

  it("returns 400 for a body field that would redirect the write", async () => {
    const form = await seedForm();
    for (const extra of [{ tenantId: OTHER_TENANT }, { ownerId: randomUUID() }, { leadStatus: "won" }]) {
      const res = await submit(form.formKey, { name: "Strict", ...extra });
      expect(res.statusCode).toBe(400);
    }
    expect(await leadsForForm(form.id)).toHaveLength(0);
  });

  it("reveals nothing about what was stored — no id, no tenant, no echo", async () => {
    const form = await seedForm();
    const res = await submit(form.formKey, { name: "Quiet", email: `qu-${randomUUID()}@x.in` });
    expect(Object.keys(res.json()).sort()).toEqual(["correlationId", "status"]);
  });
});

// ── Bots and input bounds ──────────────────────────────────────────────────────

describe("bots and input bounds", () => {
  it("drops a honeypot submission with the SAME 202 a real one gets", async () => {
    const form = await seedForm();
    const real = await submit(form.formKey, { name: "Human", email: `hu-${randomUUID()}@x.in` });
    const bot = await submit(form.formKey, { name: "Bot", email: `bo-${randomUUID()}@x.in`, _hp: "filled" });

    expect(bot.statusCode).toBe(real.statusCode);
    expect(Object.keys(bot.json()).sort()).toEqual(Object.keys(real.json()).sort());
    // Only the human's row exists — telling the bot it was detected would just teach it
    // to omit the field.
    const rows = await leadsForForm(form.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Human");
  });

  it.each([
    ["an over-long name", { name: "x".repeat(201) }],
    ["an empty name", { name: "" }],
    ["a missing name", { email: "someone@example.gov.in" }],
    ["a malformed email", { name: "Bad", email: "not-an-email" }],
    ["an over-long email", { name: "Bad", email: `${"a".repeat(320)}@x.in` }],
    ["an over-long company", { name: "Bad", company: "c".repeat(201) }],
    ["a too-short phone", { name: "Bad", phone: "1" }],
    ["an over-long utm value", { name: "Bad", utm: { source: "u".repeat(129) } }],
    ["an unknown utm key", { name: "Bad", utm: { referrer: "x" } }],
    ["an over-long source", { name: "Bad", source: "s".repeat(65) }],
  ])("returns 400 for %s", async (_label, payload) => {
    const form = await seedForm();
    const res = await submit(form.formKey, payload);
    expect(res.statusCode).toBe(400);
    expect(await leadsForForm(form.id)).toHaveLength(0);
  });

  it("refuses an oversized body before buffering it, and writes nothing", async () => {
    const form = await seedForm();
    const res = await submit(form.formKey, {
      name: "Huge",
      email: `hg-${randomUUID()}@x.in`,
      company: "c".repeat(32 * 1024),
    });
    // Fastify's bodyLimit fires before the payload is fully buffered.
    expect(res.statusCode).toBe(413);
    expect(await leadsForForm(form.id)).toHaveLength(0);
  });

  it("stores a UTM value verbatim without interpreting it as SQL", async () => {
    const form = await seedForm();
    // Drizzle binds every value as a parameter; nothing on this path concatenates SQL.
    const nasty = "'); DROP TABLE crm.contacts; --";
    await submit(form.formKey, { name: "Injection", email: `inj-${randomUUID()}@x.in`, utm: { source: nasty } });
    const rows = await leadsForForm(form.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.utmSource).toBe(nasty);
  });

  it("does not leak a stack trace or a Postgres error to an anonymous caller", async () => {
    const form = await seedForm();
    const res = await submit(form.formKey, { name: "Bad", email: "nope" });
    const body = res.json() as Record<string, unknown>;
    expect(res.statusCode).toBe(400);
    expect(Object.keys(body).sort()).toEqual(
      ["code", "correlationId", "fieldErrors", "message", "retryable"].sort(),
    );
    expect(JSON.stringify(body)).not.toMatch(/at .*\(.*:\d+:\d+\)|pg_|SQLSTATE|postgres/i);
  });
});

// ── Pure helpers ───────────────────────────────────────────────────────────────

describe("submissionIdentity", () => {
  it("prefers email, normalised the same way the blind index normalises it", () => {
    expect(submissionIdentity({ email: " Jane@Example.IN " })).toBe("email:jane@example.in");
  });

  it("falls back to phone digits so formatting does not split a prospect", () => {
    expect(submissionIdentity({ phone: "+91 98765 43210" })).toBe("phone:919876543210");
  });

  it("ignores a blank value", () => {
    expect(submissionIdentity({ email: "   ", phone: "  " })).toBeNull();
  });

  it("returns null when there is nothing to dedupe on", () => {
    // A name-only lead has no identity, so each submission is genuinely a fresh row.
    expect(submissionIdentity({})).toBeNull();
  });

  it("ignores a phone with no digits at all", () => {
    expect(submissionIdentity({ phone: "----" })).toBeNull();
  });
});

// ── Consumer idempotency ───────────────────────────────────────────────────────

describe("public capture consumer idempotency", () => {
  it("applies a redelivered message exactly once", async () => {
    const form = await seedForm();
    const { handlerFor } = captureHandlers();
    const handler = handlerFor(COMMANDS.publicLeadCapture);
    // Random messageId: a hardcoded one would poison `_inbox.processed` for every later
    // run against this database.
    const messageId = randomUUID();
    const msg = envelope(
      COMMANDS.publicLeadCapture,
      {
        contactId: randomUUID(),
        formId: form.id,
        tenantId: TENANT,
        name: "Redelivered",
        email: `rd-${randomUUID()}@example.gov.in`,
        consent: true,
        consentDate: "2026-05-01",
        leadSource: "public_form",
        utm: { source: "google" },
      },
      { tenantId: TENANT, actorId: "00000000-0000-0000-0000-000000000000", messageId },
    );

    await runWithTenant(TENANT, () => handler(msg));
    const first = await leadsForForm(form.id);
    expect(first).toHaveLength(1);

    await runWithTenant(TENANT, () => handler(msg));
    const second = await leadsForForm(form.id);
    expect(second).toHaveLength(1);
    // markProcessed short-circuits, so not even the version moves.
    expect(second[0]?.version).toBe(first[0]?.version);

    await scoped(
      TENANT,
      (tx) => tx`DELETE FROM _inbox.processed WHERE message_id = ${messageId}`,
    );
  });
});
