/**
 * CR-MKT-04 — sending domain routes, the auth-check consumer and the scheduled
 * DNS sweeper.
 *
 * The sweeper is driven with a stub resolver, so the whole feature is exercised
 * end to end without a single DNS query.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { sendingDomains, domainAuthChecks } from "../src/modules/email/schema.js";
import { registerEmailDomainConsumers } from "../src/modules/email/consumer.js";
import { sweepDomainAuthChecks } from "../src/modules/email/sweeper.js";
import type { DnsResolver } from "../src/modules/email/dns.js";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "dddd0001-1111-4000-8000-000000000001";
const ACTOR = "ddddaaaa-1111-4000-8000-0000000000aa";
const DOMAIN_ID = "dddd1111-1111-4000-8000-000000000011";
const UNKNOWN = "dddd9999-9999-4000-8000-000000000099";

const DOMAIN = "mail.dept.gov.in";
const DKIM_VALUE = "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC";
const SPF_INCLUDE = "include:spf.civitasone.gov.in";

function token(roles: string[], tid = TENANT): string {
  return signToken({ sub: ACTOR, tid, roles, sid: "sess-email" }, SECRET, 3600);
}
const bearer = (roles: string[], tid = TENANT) => ({ authorization: `Bearer ${token(roles, tid)}` });

/** Message ids this file has delivered, so cleanup can scope its reset. */
const deliveredMessageIds = new Set<string>();

async function cleanup(): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(domainAuthChecks).where(eq(domainAuthChecks.tenantId, TENANT));
    await tx.delete(sendingDomains).where(eq(sendingDomains.tenantId, TENANT));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  }));
  // _inbox.processed is a SHARED, non-tenant-scoped table. An unqualified
  // DELETE here would wipe the idempotency markers of every OTHER test file
  // running in parallel, which silently breaks their "second delivery is a
  // no-op" assertions. Only this file's own message ids are removed.
  if (deliveredMessageIds.size > 0) {
    await db.delete(processed).where(inArray(processed.messageId, [...deliveredMessageIds]));
    deliveredMessageIds.clear();
  }
}

async function seedDomain(enabled = true): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(sendingDomains).values({
      id: DOMAIN_ID, tenantId: TENANT, domain: DOMAIN, dkimSelector: "s1",
      dkimValue: DKIM_VALUE, spfInclude: SPF_INCLUDE, dmarcPolicy: "reject",
      health: "unknown", enabled, createdBy: ACTOR, updatedBy: ACTOR, version: 1,
    }).onConflictDoNothing();
  }));
}

async function deliver(topic: string, messageId: string, payload: unknown): Promise<MemoryQueue> {
  deliveredMessageIds.add(messageId);
  const q = new MemoryQueue();
  registerEmailDomainConsumers(q);
  await q.start();
  await q.publish(topic, {
    messageId, type: topic, tenantId: TENANT, actorId: ACTOR,
    correlationId: `corr-${messageId}`, schemaVersion: "1.0", payload,
  });
  await q.drain();
  await q.stop();
  return q;
}

const validRegister = {
  domain: DOMAIN,
  dkimSelector: "s1",
  dkimValue: DKIM_VALUE,
  spfInclude: SPF_INCLUDE,
  dmarcPolicy: "reject",
};

const PASSING_TXT = {
  dkimTxt: [`v=DKIM1; k=rsa; p=${DKIM_VALUE}`],
  spfTxt: [`v=spf1 ${SPF_INCLUDE} -all`],
  dmarcTxt: ["v=DMARC1; p=reject"],
};

beforeAll(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("POST /v1/notification/email/sending-domains", () => {
  it("202 for an admin registering a valid domain", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/email/sending-domains",
      headers: bearer(["notification_admin"]), payload: validRegister,
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("400 for a bare hostname with no TLD", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/email/sending-domains",
      headers: bearer(["tenant_admin"]), payload: { ...validRegister, domain: "localhost" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a domain with invalid characters", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/email/sending-domains",
      headers: bearer(["tenant_admin"]), payload: { ...validRegister, domain: "not a domain!.gov.in" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for an invalid DKIM selector", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/email/sending-domains",
      headers: bearer(["tenant_admin"]), payload: { ...validRegister, dkimSelector: "s 1!" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a DKIM value below the minimum length", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/email/sending-domains",
      headers: bearer(["tenant_admin"]), payload: { ...validRegister, dkimValue: "short" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for an unknown DMARC policy", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/email/sending-domains",
      headers: bearer(["tenant_admin"]), payload: { ...validRegister, dmarcPolicy: "block" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("422 for a bare-host spfInclude — every future SPF check would fail silently", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/email/sending-domains",
      headers: bearer(["tenant_admin"]), payload: { ...validRegister, spfInclude: "spf.civitasone.gov.in" },
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_SPF_INCLUDE");
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/email/sending-domains", payload: validRegister,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/email/sending-domains",
      headers: bearer(["audit_officer"]), payload: validRegister,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("403 for an unrelated role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/email/sending-domains",
      headers: bearer(["citizen"]), payload: validRegister,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/notification/email/sending-domains", () => {
  beforeAll(() => seedDomain());

  it("200 with the list envelope and no DKIM private material", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/email/sending-domains?limit=20",
      headers: bearer(["notification_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const row = (res.json().data as Array<{ id: string; health: string; dkimValue?: string }>)
      .find((r) => r.id === DOMAIN_ID);
    expect(row?.health).toBe("unknown");
    expect(row?.dkimValue).toBeUndefined();
    expect(res.json().meta).toMatchObject({ page: 1, pageSize: 20 });
  });

  it("200 for audit_officer", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/email/sending-domains?limit=20",
      headers: bearer(["audit_officer"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("400 when limit is omitted", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/email/sending-domains", headers: bearer(["tenant_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/notification/email/sending-domains?limit=20" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unauthorised role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/email/sending-domains?limit=20", headers: bearer(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/notification/email/sending-domains/:id/auth-checks", () => {
  beforeAll(() => seedDomain());

  it("202 for a submitted check result", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/email/sending-domains/${DOMAIN_ID}/auth-checks`,
      headers: bearer(["notification_admin"]), payload: { ...PASSING_TXT, source: "manual" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("202 with an empty body — the defaults record an all-missing observation", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/email/sending-domains/${DOMAIN_ID}/auth-checks`,
      headers: bearer(["notification_admin"]), payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("404 for an unknown sending domain", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/email/sending-domains/${UNKNOWN}/auth-checks`,
      headers: bearer(["notification_admin"]), payload: PASSING_TXT,
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("400 for a non-uuid id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/notification/email/sending-domains/nope/auth-checks",
      headers: bearer(["notification_admin"]), payload: PASSING_TXT,
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for an unknown source", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/email/sending-domains/${DOMAIN_ID}/auth-checks`,
      headers: bearer(["notification_admin"]), payload: { ...PASSING_TXT, source: "guesswork" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for a non-ISO checkedAt", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/email/sending-domains/${DOMAIN_ID}/auth-checks`,
      headers: bearer(["notification_admin"]), payload: { ...PASSING_TXT, checkedAt: "recently" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 for more TXT strings than the cap allows", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/email/sending-domains/${DOMAIN_ID}/auth-checks`,
      headers: bearer(["notification_admin"]),
      payload: { dkimTxt: Array.from({ length: 21 }, () => "v=DKIM1") },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/email/sending-domains/${DOMAIN_ID}/auth-checks`,
      payload: PASSING_TXT,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for a read-only role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/notification/email/sending-domains/${DOMAIN_ID}/auth-checks`,
      headers: bearer(["audit_officer"]), payload: PASSING_TXT,
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/notification/email/sending-domains/:id/health", () => {
  beforeAll(() => seedDomain());

  it("200 with current health, expectations and history", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/email/sending-domains/${DOMAIN_ID}/health`,
      headers: bearer(["notification_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.sendingDomainId).toBe(DOMAIN_ID);
    expect(data.domain).toBe(DOMAIN);
    // unknown health must NOT be a green light to send.
    expect(data.sendingAllowed).toBe(false);
    expect(data.expected.dkimSelector).toBe("s1");
    expect(Array.isArray(data.history)).toBe(true);
  });

  it("200 with an explicit history limit", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/email/sending-domains/${DOMAIN_ID}/health?limit=5`,
      headers: bearer(["notification_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("400 for a limit above the maximum", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/email/sending-domains/${DOMAIN_ID}/health?limit=900`,
      headers: bearer(["notification_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("404 for an unknown sending domain", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/email/sending-domains/${UNKNOWN}/health`,
      headers: bearer(["notification_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("400 for a non-uuid id", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/email/sending-domains/nope/health",
      headers: bearer(["notification_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/email/sending-domains/${DOMAIN_ID}/health`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unauthorised role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: `/v1/notification/email/sending-domains/${DOMAIN_ID}/health`,
      headers: bearer(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/notification/email/dmarc-policies", () => {
  it("200 listing the accepted policies", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/email/dmarc-policies", headers: bearer(["notification_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual(["none", "quarantine", "reject"]);
  });

  it("401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/notification/email/dmarc-policies" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 for an unauthorised role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/notification/email/dmarc-policies", headers: bearer(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("email domain consumer", () => {
  beforeEach(cleanup);

  async function rows() {
    return runWithTenant(TENANT, () => db.transaction(async (tx) => ({
      domains: await tx.select().from(sendingDomains).where(eq(sendingDomains.tenantId, TENANT)),
      checks: await tx.select().from(domainAuthChecks).where(eq(domainAuthChecks.tenantId, TENANT)),
      outbox: await tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)),
    })));
  }

  const registerPayload = { id: DOMAIN_ID, tenantId: TENANT, ...validRegister };

  it("registers a domain at health unknown and lowercases it", async () => {
    await deliver(COMMANDS.registerSendingDomain, "dddd3333-1111-4000-8000-000000000301", {
      ...registerPayload, domain: "MAIL.DEPT.GOV.IN",
    });
    const { domains, outbox } = await rows();
    expect(domains).toHaveLength(1);
    expect(domains[0]?.domain).toBe(DOMAIN);
    expect(domains[0]?.health).toBe("unknown");
    expect(outbox.map((m) => m.eventType)).toContain(EVENTS.sendingDomainRegistered);
    expect(outbox.map((m) => m.eventType)).toContain("audit.event.record");
  });

  it("registering the same messageId twice writes one row (idempotency)", async () => {
    const MSG = "dddd3333-1111-4000-8000-000000000302";
    await deliver(COMMANDS.registerSendingDomain, MSG, registerPayload);
    const first = await rows();
    await deliver(COMMANDS.registerSendingDomain, MSG, registerPayload);
    const second = await rows();
    expect(second.domains).toHaveLength(1);
    expect(second.outbox).toHaveLength(first.outbox.length);
  });

  it("records an all-passing check and rolls health up to healthy", async () => {
    await seedDomain();
    await deliver(COMMANDS.recordDomainAuthCheck, "dddd3333-1111-4000-8000-000000000303", {
      id: "dddd4444-1111-4000-8000-00000000004a", tenantId: TENANT,
      sendingDomainId: DOMAIN_ID, ...PASSING_TXT, source: "manual",
    });
    const { domains, checks, outbox } = await rows();
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ dkimStatus: "pass", spfStatus: "pass", dmarcStatus: "pass", health: "healthy" });
    expect(checks[0]?.observed).toEqual(PASSING_TXT);
    expect(domains[0]?.health).toBe("healthy");
    expect(domains[0]?.lastCheckedAt).not.toBeNull();
    expect(domains[0]?.version).toBe(2);
    expect(outbox.map((m) => m.eventType)).toContain(EVENTS.domainAuthCheckRecorded);
    // Healthy must NOT raise the alerting event.
    expect(outbox.map((m) => m.eventType)).not.toContain(EVENTS.domainAuthFailing);
  });

  it("raises the failing alert when DKIM is absent", async () => {
    await seedDomain();
    await deliver(COMMANDS.recordDomainAuthCheck, "dddd3333-1111-4000-8000-000000000304", {
      id: "dddd4444-1111-4000-8000-00000000004b", tenantId: TENANT,
      sendingDomainId: DOMAIN_ID, dkimTxt: [], spfTxt: PASSING_TXT.spfTxt, dmarcTxt: PASSING_TXT.dmarcTxt,
      source: "scheduled",
    });
    const { domains, outbox } = await rows();
    expect(domains[0]?.health).toBe("failing");
    expect(outbox.map((m) => m.eventType)).toContain(EVENTS.domainAuthFailing);
  });

  it("rolls a DMARC-only problem up to degraded without alerting", async () => {
    await seedDomain();
    await deliver(COMMANDS.recordDomainAuthCheck, "dddd3333-1111-4000-8000-000000000305", {
      id: "dddd4444-1111-4000-8000-00000000004c", tenantId: TENANT,
      sendingDomainId: DOMAIN_ID, dkimTxt: PASSING_TXT.dkimTxt, spfTxt: PASSING_TXT.spfTxt,
      dmarcTxt: ["v=DMARC1; p=none"], source: "scheduled",
    });
    const { domains, outbox } = await rows();
    expect(domains[0]?.health).toBe("degraded");
    expect(outbox.map((m) => m.eventType)).not.toContain(EVENTS.domainAuthFailing);
  });

  it("records health unknown when nothing resolved at all", async () => {
    await seedDomain();
    await deliver(COMMANDS.recordDomainAuthCheck, "dddd3333-1111-4000-8000-000000000306", {
      id: "dddd4444-1111-4000-8000-00000000004d", tenantId: TENANT,
      sendingDomainId: DOMAIN_ID, dkimTxt: [], spfTxt: [], dmarcTxt: [], source: "scheduled",
    });
    const { domains } = await rows();
    expect(domains[0]?.health).toBe("unknown");
  });

  it("recording the same check twice writes one row (idempotency)", async () => {
    await seedDomain();
    const MSG = "dddd3333-1111-4000-8000-000000000307";
    const payload = {
      id: "dddd4444-1111-4000-8000-00000000004e", tenantId: TENANT,
      sendingDomainId: DOMAIN_ID, ...PASSING_TXT, source: "scheduled" as const,
    };
    await deliver(COMMANDS.recordDomainAuthCheck, MSG, payload);
    const first = await rows();
    await deliver(COMMANDS.recordDomainAuthCheck, MSG, payload);
    const second = await rows();
    expect(second.checks).toHaveLength(1);
    expect(second.domains[0]?.version).toBe(first.domains[0]?.version);
  });

  it("honours an explicit checkedAt", async () => {
    await seedDomain();
    const when = "2026-02-01T08:00:00.000Z";
    await deliver(COMMANDS.recordDomainAuthCheck, "dddd3333-1111-4000-8000-000000000308", {
      id: "dddd4444-1111-4000-8000-00000000004f", tenantId: TENANT,
      sendingDomainId: DOMAIN_ID, ...PASSING_TXT, source: "scheduled", checkedAt: when,
    });
    const { checks } = await rows();
    expect(checks[0]?.checkedAt.toISOString()).toBe(when);
  });

  it("dead-letters a check for an unknown domain", async () => {
    const q = await deliver(COMMANDS.recordDomainAuthCheck, "dddd3333-1111-4000-8000-000000000309", {
      id: "dddd4444-1111-4000-8000-000000000050", tenantId: TENANT,
      sendingDomainId: UNKNOWN, ...PASSING_TXT, source: "scheduled",
    });
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("SENDING_DOMAIN_NOT_FOUND");
    expect((await rows()).checks).toHaveLength(0);
  });

  it("dead-letters an unparseable checkedAt", async () => {
    await seedDomain();
    const q = await deliver(COMMANDS.recordDomainAuthCheck, "dddd3333-1111-4000-8000-000000000310", {
      id: "dddd4444-1111-4000-8000-000000000051", tenantId: TENANT,
      sendingDomainId: DOMAIN_ID, ...PASSING_TXT, source: "scheduled", checkedAt: "eventually",
    });
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]?.error).toContain("ISO-8601");
  });
});

describe("domain auth sweeper — stubbed resolver, no network", () => {
  beforeEach(cleanup);

  function stubResolver(map: Record<string, string[][]>): DnsResolver {
    return { resolveTxt: async (host) => map[host] ?? [] };
  }

  const PASSING_DNS = {
    [`s1._domainkey.${DOMAIN}`]: [[`v=DKIM1; k=rsa; p=${DKIM_VALUE}`]],
    [DOMAIN]: [[`v=spf1 ${SPF_INCLUDE} -all`]],
    [`_dmarc.${DOMAIN}`]: [["v=DMARC1; p=reject"]],
  };

  it("publishes a record command for each enabled domain", async () => {
    await seedDomain(true);
    const q = new MemoryQueue();
    const published: Array<{ topic: string; payload: unknown }> = [];
    q.subscribe(COMMANDS.recordDomainAuthCheck, async (msg) => {
      published.push({ topic: COMMANDS.recordDomainAuthCheck, payload: (msg as { payload: unknown }).payload });
    });
    await q.start();
    const submitted = await sweepDomainAuthChecks(q, stubResolver(PASSING_DNS));
    await q.drain();
    await q.stop();

    expect(submitted).toBeGreaterThanOrEqual(1);
    const mine = published.find((p) => (p.payload as { sendingDomainId?: string }).sendingDomainId === DOMAIN_ID);
    expect(mine).toBeDefined();
    expect((mine?.payload as { source?: string }).source).toBe("scheduled");
    expect((mine?.payload as { dkimTxt?: string[] }).dkimTxt?.[0]).toContain("v=DKIM1");
  });

  it("skips disabled domains", async () => {
    await seedDomain(false);
    const q = new MemoryQueue();
    const seen: string[] = [];
    q.subscribe(COMMANDS.recordDomainAuthCheck, async (msg) => {
      seen.push((msg as { payload: { sendingDomainId: string } }).payload.sendingDomainId);
    });
    await q.start();
    await sweepDomainAuthChecks(q, stubResolver(PASSING_DNS));
    await q.drain();
    await q.stop();
    expect(seen).not.toContain(DOMAIN_ID);
  });

  it("a resolver failure for one domain does not abort the sweep", async () => {
    await seedDomain(true);
    const failing: DnsResolver = {
      resolveTxt: async () => { throw new Error("SERVFAIL"); },
    };
    const q = new MemoryQueue();
    await q.start();
    // Must resolve, not reject: the sweep logs and moves on.
    await expect(sweepDomainAuthChecks(q, failing)).resolves.toBeTypeOf("number");
    await q.stop();
  });

  it("the sweep result feeds the consumer end to end and lands healthy", async () => {
    await seedDomain(true);
    const publishQ = new MemoryQueue();
    const captured: Array<Record<string, unknown>> = [];
    publishQ.subscribe(COMMANDS.recordDomainAuthCheck, async (msg) => {
      captured.push((msg as { payload: Record<string, unknown> }).payload);
    });
    await publishQ.start();
    await sweepDomainAuthChecks(publishQ, stubResolver(PASSING_DNS));
    await publishQ.drain();
    await publishQ.stop();

    const payload = captured.find((p) => p.sendingDomainId === DOMAIN_ID);
    expect(payload).toBeDefined();
    await deliver(COMMANDS.recordDomainAuthCheck, "dddd5555-1111-4000-8000-000000000501", payload);

    const domains = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(sendingDomains).where(eq(sendingDomains.id, DOMAIN_ID))));
    expect(domains[0]?.health).toBe("healthy");
  });
});
