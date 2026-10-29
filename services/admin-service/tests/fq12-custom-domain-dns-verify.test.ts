/**
 * FQ12-SEC item #20: POST /v1/admin/custom-domains/:id/verify was a stub that
 * marked ANY host verified with no DNS proof (domain takeover). The consumer
 * now resolves the challenge the register flow issued and FAILS CLOSED.
 *
 * The DNS resolver is injected (setDnsResolver) so nothing here touches the
 * network. Hostnames use the reserved .test TLD.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { eq, and } from "drizzle-orm";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { customDomains } from "../src/modules/custom-domains/schema.js";
import { registerCustomDomainConsumers } from "../src/modules/custom-domains/consumer.js";
import {
  checkDomainOwnership, setDnsResolver, challengeHost, CNAME_CHALLENGE_TARGET, type DnsResolver,
} from "../src/modules/custom-domains/dns-verify.js";
import { COMMANDS } from "../src/topics.js";
import { normalizeDomain, registerDomainBody } from "../src/modules/custom-domains/validators.js";

const T = randomUUID();
const T2 = randomUUID();
const ACTOR = randomUUID();
const TOKEN = `civitasone-verify-${randomUUID().replace(/-/g, "")}`;

function dnsErr(code: string): Error {
  return Object.assign(new Error(code), { code });
}

/** Resolver that answers only for the given host -> records map; everything else is NXDOMAIN. */
function fakeResolver(txt: Record<string, string[][]> = {}, cname: Record<string, string[]> = {}): DnsResolver & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async resolveTxt(h) { calls.push(`TXT ${h}`); if (h in txt) return txt[h]!; throw dnsErr("ENOTFOUND"); },
    async resolveCname(h) { calls.push(`CNAME ${h}`); if (h in cname) return cname[h]!; throw dnsErr("ENOTFOUND"); },
  };
}

describe("dns-verify: checkDomainOwnership (pure, injected resolver)", () => {
  const base = { domain: "owned.example.test", verificationMethod: "dns_txt", verificationToken: TOKEN };
  const host = challengeHost("dns_txt", "owned.example.test");

  it("verifies only when the TXT challenge resolves and matches", async () => {
    expect(host).toBe("_civitasone-verification.owned.example.test");
    const r = await checkDomainOwnership(base, { resolver: fakeResolver({ [host]: [["unrelated"], [TOKEN]] }) });
    expect(r).toEqual({ verified: true });
  });

  it("joins chunked TXT strings", async () => {
    const r = await checkDomainOwnership(base, { resolver: fakeResolver({ [host]: [[TOKEN.slice(0, 10), TOKEN.slice(10)]] }) });
    expect(r.verified).toBe(true);
  });

  it("NXDOMAIN -> not verified (no_record)", async () => {
    const r = await checkDomainOwnership(base, { resolver: fakeResolver() });
    expect(r).toMatchObject({ verified: false, reason: "no_record" });
  });

  it("wrong TXT value -> not verified (mismatch)", async () => {
    const r = await checkDomainOwnership(base, { resolver: fakeResolver({ [host]: [["civitasone-verify-someone-else"]] }) });
    expect(r).toMatchObject({ verified: false, reason: "mismatch" });
  });

  it("resolver error -> not verified (dns_error), never throws", async () => {
    const resolver: DnsResolver = { resolveTxt: async () => { throw dnsErr("ESERVFAIL"); }, resolveCname: async () => [] };
    const r = await checkDomainOwnership(base, { resolver });
    expect(r).toMatchObject({ verified: false, reason: "dns_error" });
  });

  it("resolver timeout -> not verified (timeout)", async () => {
    const resolver: DnsResolver = { resolveTxt: () => new Promise(() => undefined), resolveCname: async () => [] };
    const r = await checkDomainOwnership(base, { resolver, timeoutMs: 20 });
    expect(r).toMatchObject({ verified: false, reason: "timeout" });
  });

  it("empty token is never matched", async () => {
    const r = await checkDomainOwnership({ ...base, verificationToken: "" }, { resolver: fakeResolver({ [host]: [[""]] }) });
    expect(r.verified).toBe(false);
  });

  it("CNAME: verified only when the challenge points at the issued target", async () => {
    const ch = challengeHost("dns_cname", "c.example.test");
    const ok = await checkDomainOwnership(
      { domain: "c.example.test", verificationMethod: "dns_cname", verificationToken: TOKEN },
      { resolver: fakeResolver({}, { [ch]: [`${CNAME_CHALLENGE_TARGET}.`] }) },
    );
    expect(ok.verified).toBe(true);
    const bad = await checkDomainOwnership(
      { domain: "c.example.test", verificationMethod: "dns_cname", verificationToken: TOKEN },
      { resolver: fakeResolver({}, { [ch]: ["attacker.example.test"] }) },
    );
    expect(bad).toMatchObject({ verified: false, reason: "mismatch" });
  });

  it("unknown method -> not verified", async () => {
    const r = await checkDomainOwnership({ ...base, verificationMethod: "http_file" }, { resolver: fakeResolver() });
    expect(r).toMatchObject({ verified: false, reason: "unsupported" });
  });
});

describe("custom-domains verify consumer: fail closed against the DB", () => {
  let q: Queue;

  async function waitFor<V>(fn: () => Promise<V>, ok: (v: V) => boolean, timeoutMs = 5000): Promise<V> {
    const deadline = Date.now() + timeoutMs;
    let last = await fn();
    while (!ok(last) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      last = await fn();
    }
    return last;
  }

  const readRow = (id: string) => runWithTenant(T, () => db.transaction((tx) =>
    tx.select().from(customDomains).where(and(eq(customDomains.id, id), eq(customDomains.tenantId, T)))));

  async function register(domain: string, method: "dns_txt" | "dns_cname" = "dns_txt"): Promise<string> {
    const id = randomUUID();
    await q.publish(COMMANDS.customDomainRegister, {
      messageId: randomUUID(), type: COMMANDS.customDomainRegister, tenantId: T, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id, tenantId: T, domain, verificationMethod: method, verificationToken: TOKEN },
    });
    await waitFor(() => readRow(id), (r) => r.length === 1);
    return id;
  }

  async function verify(id: string): Promise<string> {
    const correlationId = randomUUID();
    await q.publish(COMMANDS.customDomainVerify, {
      messageId: randomUUID(), type: COMMANDS.customDomainVerify, tenantId: T, actorId: ACTOR,
      correlationId, schemaVersion: "1.0", payload: { domainId: id, tenantId: T },
    });
    return correlationId;
  }

  const auditFor = (correlationId: string) => runWithTenant(T, () => db.transaction((tx) =>
    tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, T), eq(outboxMessages.correlationId, correlationId)))));

  beforeAll(async () => {
    const mq = new MemoryQueue();
    const raw = mq.subscribe.bind(mq);
    (mq as Queue).subscribe = ((topic: string, h: Handler) => raw(topic, withTenantConsumer(h) as Handler)) as typeof mq.subscribe;
    q = mq;
    registerCustomDomainConsumers(q);
    await q.start();
  });
  afterEach(() => setDnsResolver(null));
  afterAll(async () => {
    await runWithTenant(T, () => db.transaction(async (tx) => {
      await tx.delete(customDomains).where(eq(customDomains.tenantId, T));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, T));
    }));
    await runWithTenant(T2, () => db.transaction(async (tx) => {
      await tx.delete(customDomains).where(eq(customDomains.tenantId, T2));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, T2));
    }));
    await q.stop();
    await sqlClient.end();
  });

  it("an unowned host with no DNS record stays pending_verification (was: verified)", async () => {
    const resolver = fakeResolver();
    setDnsResolver(resolver);
    const id = await register("unowned-fq12.example.test");
    const corr = await verify(id);
    const out = await waitFor(() => auditFor(corr), (r) => r.length >= 1);
    const row = (await readRow(id))[0]!;
    expect(row.status).toBe("pending_verification");
    expect(row.verifiedAt).toBeNull();
    expect(resolver.calls).toContain("TXT _civitasone-verification.unowned-fq12.example.test");
    const types = out.map((m) => m.eventType);
    expect(types).not.toContain("admin.custom_domain.verified");
    const audit = out.find((m) => m.eventType === "audit.event.record")!;
    expect(audit.payload).toMatchObject({ action: "verify", outcome: "failure", reason: "no_record", resourceId: id });
  });

  it("resolver error leaves the domain unverified", async () => {
    setDnsResolver({ resolveTxt: async () => { throw dnsErr("ECONNREFUSED"); }, resolveCname: async () => [] });
    const id = await register("dnserr-fq12.example.test");
    const corr = await verify(id);
    await waitFor(() => auditFor(corr), (r) => r.length >= 1);
    const row = (await readRow(id))[0]!;
    expect(row.status).toBe("pending_verification");
    expect(row.verifiedAt).toBeNull();
  });

  it("a wrong TXT value marks the domain failed, never verified", async () => {
    const id = await register("wrong-fq12.example.test");
    setDnsResolver(fakeResolver({ "_civitasone-verification.wrong-fq12.example.test": [["civitasone-verify-not-yours"]] }));
    const corr = await verify(id);
    await waitFor(() => auditFor(corr), (r) => r.length >= 1);
    const row = (await readRow(id))[0]!;
    expect(row.status).toBe("failed");
    expect(row.verifiedAt).toBeNull();
  });

  it("a matching TXT challenge verifies the domain", async () => {
    const id = await register("owned-fq12.example.test");
    setDnsResolver(fakeResolver({ "_civitasone-verification.owned-fq12.example.test": [[TOKEN]] }));
    const corr = await verify(id);
    const out = await waitFor(() => auditFor(corr), (r) => r.length >= 2);
    const row = (await readRow(id))[0]!;
    expect(row.status).toBe("verified");
    expect(row.verifiedAt).not.toBeNull();
    expect(out.map((m) => m.eventType)).toContain("admin.custom_domain.verified");
  });

  // ── Review of PR #2372, item 1: case variants must not let a second tenant
  // claim (and verify) the same host.
  it("validator canonicalises the domain (trim, lower-case, strip root dot)", () => {
    expect(normalizeDomain("  Victim.Example.TEST. ")).toBe("victim.example.test");
    expect(registerDomainBody.parse({ domain: "VICTIM.EXAMPLE.TEST." }).domain).toBe("victim.example.test");
    expect(registerDomainBody.safeParse({ domain: "vïctim.example.test" }).success).toBe(false); // U-labels: use punycode
    expect(registerDomainBody.parse({ domain: "xn--vctim-6qa.example.test" }).domain).toBe("xn--vctim-6qa.example.test");
  });

  it("two tenants: an upper-case / trailing-dot variant of a registered host is rejected, so only the owner can verify it", async () => {
    const host = `victim-${randomUUID().slice(0, 8)}.example.test`;
    const ownerId = await register(host, "dns_cname");

    // Tenant B tries the same host with different case and a root dot (consumer path).
    const attackerId = randomUUID();
    await q.publish(COMMANDS.customDomainRegister, {
      messageId: randomUUID(), type: COMMANDS.customDomainRegister, tenantId: T2, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id: attackerId, tenantId: T2, domain: `${host.toUpperCase()}.`, verificationMethod: "dns_cname", verificationToken: TOKEN },
    });
    await new Promise((r) => setTimeout(r, 400));
    const t2Rows = await runWithTenant(T2, () => db.transaction((tx) => tx.select().from(customDomains).where(eq(customDomains.tenantId, T2))));
    expect(t2Rows).toEqual([]);

    // And the database itself refuses a raw case variant (migration 0057 index).
    let code: string | undefined;
    try {
      await runWithTenant(T2, () => db.transaction((tx) => tx.insert(customDomains).values({
        id: randomUUID(), tenantId: T2, domain: host.toUpperCase(), status: "pending_verification",
        verificationToken: TOKEN, verificationMethod: "dns_cname", sslStatus: "pending",
        createdBy: ACTOR, updatedBy: ACTOR, version: 1,
      })));
    } catch (e) {
      code = (e as { code?: string }).code;
    }
    expect(code).toBe("23505");

    // The shared CNAME challenge now verifies only the owner's single row.
    setDnsResolver(fakeResolver({}, { [challengeHost("dns_cname", host)]: [CNAME_CHALLENGE_TARGET] }));
    const corr = await verify(ownerId);
    await waitFor(() => auditFor(corr), (r) => r.length >= 2);
    expect((await readRow(ownerId))[0]!.status).toBe("verified");
    const all = await runWithTenant(T2, () => db.transaction((tx) => tx.select().from(customDomains).where(eq(customDomains.id, attackerId))));
    expect(all).toEqual([]);
  });
});
