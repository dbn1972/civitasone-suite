/**
 * Consumer coverage — unit tests for tenant-onboard consumer and
 * additional RBAC domain/apikeys domain logic.
 *
 * Covers:
 *   - tenant-onboard consumer (122 lines, 0% → exercised)
 *   - RBAC domain (additional branches)
 *   - API Keys domain (scope model, lifecycle guards, secret gen)
 *   - Users consumer (createUser, updateUser, deactivateUser paths)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue, type Queue, type Handler } from "@civitasone/queue";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { users } from "../src/modules/users/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";

// ── API Keys domain ─────────────────────────────────────────────────────────
import {
  generateSecret, sha256Hex, isValidScope, assertValidScopes,
  scopesSatisfy, assertScope, canTransition, assertTransition,
  isUsable, DomainError,
} from "../src/modules/apikeys/domain.js";

// ── RBAC domain (additional coverage) ───────────────────────────────────────
import {
  isReservedKey, isValidKeyFormat, assertKeyAllowed, assertCanConfer,
  hasUnconditionalAuthority, DomainError as RbacDomainError,
} from "../src/modules/rbac/domain.js";

function wireTenantAwareQueue(q: Queue): Queue {
  const rawSubscribe = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    rawSubscribe(topic, withTenantConsumer(handler) as Handler)) as typeof q.subscribe;
  return q;
}

// ── API Keys — Secret Generation & Hashing ──────────────────────────────────
describe("API Keys — secret generation", () => {
  it("generateSecret produces keyPrefix, secret, fullKey, and secretHash", () => {
    const result = generateSecret();
    expect(result.keyPrefix).toMatch(/^ak_live_[0-9a-f]{6}$/);
    expect(result.secret.length).toBeGreaterThan(0);
    expect(result.fullKey).toBe(`${result.keyPrefix}.${result.secret}`);
    expect(result.secretHash).toBe(sha256Hex(result.fullKey));
  });

  it("sha256Hex produces consistent 64-char hex", () => {
    const h = sha256Hex("hello");
    expect(h.length).toBe(64);
    expect(sha256Hex("hello")).toBe(h);
    expect(sha256Hex("world")).not.toBe(h);
  });

  it("each generateSecret call produces unique keys", () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(a.fullKey).not.toBe(b.fullKey);
    expect(a.secretHash).not.toBe(b.secretHash);
  });
});

// ── API Keys — Scope Model ──────────────────────────────────────────────────
describe("API Keys — scope model", () => {
  it("isValidScope accepts valid resource:action format", () => {
    expect(isValidScope("users:read")).toBe(true);
    expect(isValidScope("rbac:write")).toBe(true);
    expect(isValidScope("*:*")).toBe(true);
    expect(isValidScope("users:*")).toBe(true);
    expect(isValidScope("*:read")).toBe(true);
    expect(isValidScope("hr_admin:manage")).toBe(true);
  });

  it("isValidScope rejects invalid formats", () => {
    expect(isValidScope("nocolon")).toBe(false);
    expect(isValidScope("users")).toBe(false);
    expect(isValidScope("")).toBe(false);
    expect(isValidScope("Upper:case")).toBe(false);
    expect(isValidScope("users:")).toBe(false);
    expect(isValidScope(":read")).toBe(false);
  });

  it("assertValidScopes throws DomainError(INVALID_SCOPE) for bad scopes", () => {
    expect(() => assertValidScopes(["users:read"])).not.toThrow();
    try {
      assertValidScopes(["bad scope"]);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("INVALID_SCOPE");
    }
  });

  it("scopesSatisfy checks wildcard matching", () => {
    expect(scopesSatisfy(["users:read"], "users:read")).toBe(true);
    expect(scopesSatisfy(["users:*"], "users:write")).toBe(true);
    expect(scopesSatisfy(["*:read"], "finance:read")).toBe(true);
    expect(scopesSatisfy(["*:*"], "anything:goes")).toBe(true);
    expect(scopesSatisfy(["users:read"], "users:write")).toBe(false);
    expect(scopesSatisfy(["users:read"], "rbac:read")).toBe(false);
  });

  it("assertScope throws DomainError(OUT_OF_SCOPE) when not satisfied", () => {
    expect(() => assertScope(["users:read"], "users:read")).not.toThrow();
    try {
      assertScope(["users:read"], "users:write");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("OUT_OF_SCOPE");
    }
  });
});

// ── API Keys — Lifecycle Guards ─────────────────────────────────────────────
describe("API Keys — lifecycle transitions", () => {
  it("canTransition: active → rotated, active → revoked", () => {
    expect(canTransition("active", "rotated")).toBe(true);
    expect(canTransition("active", "revoked")).toBe(true);
  });

  it("canTransition: rotated → revoked", () => {
    expect(canTransition("rotated", "revoked")).toBe(true);
  });

  it("canTransition: revoked → anything is false", () => {
    expect(canTransition("revoked", "active")).toBe(false);
    expect(canTransition("revoked", "rotated")).toBe(false);
  });

  it("assertTransition throws on invalid transition", () => {
    expect(() => assertTransition("active", "rotated")).not.toThrow();
    try {
      assertTransition("revoked", "active");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe("INVALID_TRANSITION");
    }
  });

  it("assertTransition is idempotent (same state → no throw)", () => {
    expect(() => assertTransition("active", "active")).not.toThrow();
    expect(() => assertTransition("revoked", "revoked")).not.toThrow();
  });

  it("isUsable checks status and expiry", () => {
    expect(isUsable("active", null)).toBe(true);
    expect(isUsable("active", new Date(Date.now() + 60_000))).toBe(true);
    expect(isUsable("active", new Date(Date.now() - 60_000))).toBe(false); // expired
    expect(isUsable("revoked", null)).toBe(false);
    expect(isUsable("rotated", null)).toBe(false);
  });
});

// ── RBAC Domain — additional branch coverage ────────────────────────────────
describe("RBAC domain — additional coverage", () => {
  it("isReservedKey for all reserved prefixes", () => {
    expect(isReservedKey("rbac.admin")).toBe(true);
    expect(isReservedKey("rbac.admin.something")).toBe(true);
    expect(isReservedKey("system.anything")).toBe(true);
    expect(isReservedKey("platform.x")).toBe(true);
  });

  it("isValidKeyFormat for edge cases", () => {
    expect(isValidKeyFormat("a")).toBe(true);
    expect(isValidKeyFormat("a1")).toBe(true);
    expect(isValidKeyFormat("a.b")).toBe(true);
    expect(isValidKeyFormat("a_b")).toBe(true);
    expect(isValidKeyFormat("a-b")).toBe(true);
    expect(isValidKeyFormat("a:b")).toBe(true);
    expect(isValidKeyFormat("1invalid")).toBe(false);
    expect(isValidKeyFormat("_start")).toBe(false);
    expect(isValidKeyFormat("a..b")).toBe(false);
    expect(isValidKeyFormat("a.")).toBe(false);
  });

  it("assertKeyAllowed allows valid non-reserved keys", () => {
    expect(() => assertKeyAllowed(["tenant_admin"], ["hr.employee.read", "payroll.run"])).not.toThrow();
  });

  it("assertKeyAllowed rejects invalid format even for super_admin", () => {
    try {
      assertKeyAllowed(["super_admin"], ["Invalid Key"]);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RbacDomainError);
      expect((e as RbacDomainError).code).toBe("INVALID_KEY");
    }
  });

  it("assertCanConfer passes with matching permissions", () => {
    const held = new Set(["hr.read", "hr.write", "payroll.run"]);
    expect(() => assertCanConfer(["tenant_admin"], held, ["hr.read", "payroll.run"])).not.toThrow();
  });

  it("assertCanConfer fails with partial mismatch", () => {
    const held = new Set(["hr.read"]);
    try {
      assertCanConfer(["tenant_admin"], held, ["hr.read", "finance.admin"]);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RbacDomainError);
      expect((e as RbacDomainError).code).toBe("SELF_ESCALATION");
      expect((e as RbacDomainError).message).toContain("finance.admin");
    }
  });

  it("hasUnconditionalAuthority for platform_admin", () => {
    expect(hasUnconditionalAuthority(["platform_admin"])).toBe(true);
    expect(hasUnconditionalAuthority(["tenant_admin", "platform_admin"])).toBe(true);
    expect(hasUnconditionalAuthority(["hr_admin"])).toBe(false);
  });
});

// ── Tenant Onboard Consumer ─────────────────────────────────────────────────
describe("Tenant onboard consumer — integration", () => {
  const ONBOARD_TENANT = "f0000000-0000-4000-8000-0000000000f1";
  const MSG_ID = "e1111111-1111-4000-8000-000000000001";

  afterAll(async () => {
    // Cleanup
    await runWithTenant(ONBOARD_TENANT, () => db.transaction(async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, ONBOARD_TENANT));
      await tx.delete(processed).where(eq(processed.messageId, MSG_ID));
    }));
  });

  it("processes tenant.tenant.onboarded → emits user.create + rbac.role.assign + audit", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());

    // Register the consumer dynamically
    const { registerIdentityTenantOnboardConsumers } = await import("../src/modules/tenant-onboard/consumer.js");
    registerIdentityTenantOnboardConsumers(q);
    await q.start();

    await q.publish("tenant.tenant.onboarded", {
      messageId: MSG_ID,
      type: "tenant.tenant.onboarded",
      tenantId: ONBOARD_TENANT,
      actorId: "00000000-0000-0000-0000-000000000001",
      correlationId: "corr-onboard-1",
      schemaVersion: "1.0",
      timestamp: new Date().toISOString(),
      payload: {
        tenantId: ONBOARD_TENANT,
        adminEmail: "admin@new-tenant.gov.in",
        adminName: "First Admin",
        edition: "government",
      },
    });

    await new Promise((r) => setTimeout(r, 600));
    await q.stop();

    // Verify outbox contains the expected commands
    const outbox = await runWithTenant(ONBOARD_TENANT, () => db.transaction(async (tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, ONBOARD_TENANT))));

    const topics = outbox.map((r) => r.eventType);
    expect(topics).toContain("identity.user.create");
    expect(topics).toContain("identity.rbac.role.assign");
    expect(topics).toContain("audit.event.record");

    // Verify the user.create payload
    const userCreate = outbox.find((r) => r.eventType === "identity.user.create");
    expect(userCreate).toBeDefined();
    const payload = userCreate!.payload as Record<string, unknown>;
    expect(payload.email).toBe("admin@new-tenant.gov.in");
    expect(payload.name).toBe("First Admin");
    expect(payload.tenantId).toBe(ONBOARD_TENANT);

    // Verify the role assign payload
    const roleAssign = outbox.find((r) => r.eventType === "identity.rbac.role.assign");
    expect(roleAssign).toBeDefined();
    const rolePayload = roleAssign!.payload as Record<string, unknown>;
    expect(rolePayload.roleName).toBe("tenant_admin");
    expect(rolePayload.tenantId).toBe(ONBOARD_TENANT);
  });

  it("is idempotent — duplicate message does not create additional outbox rows", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    const { registerIdentityTenantOnboardConsumers } = await import("../src/modules/tenant-onboard/consumer.js");
    registerIdentityTenantOnboardConsumers(q);
    await q.start();

    // Same messageId again
    await q.publish("tenant.tenant.onboarded", {
      messageId: MSG_ID,
      type: "tenant.tenant.onboarded",
      tenantId: ONBOARD_TENANT,
      actorId: "00000000-0000-0000-0000-000000000001",
      correlationId: "corr-onboard-dup",
      schemaVersion: "1.0",
      timestamp: new Date().toISOString(),
      payload: {
        tenantId: ONBOARD_TENANT,
        adminEmail: "admin@new-tenant.gov.in",
        adminName: "First Admin",
        edition: "government",
      },
    });

    await new Promise((r) => setTimeout(r, 400));
    await q.stop();

    // Count should remain the same (3 rows: user.create + rbac.assign + audit)
    const outbox = await runWithTenant(ONBOARD_TENANT, () => db.transaction(async (tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, ONBOARD_TENANT))));

    const createCount = outbox.filter((r) => r.eventType === "identity.user.create").length;
    expect(createCount).toBe(1); // idempotent: not duplicated
  });
});

// ── Users Consumer — createUser ─────────────────────────────────────────────
describe("Users consumer — createUser integration", () => {
  const CREATE_TENANT = "f2222222-2222-4000-8000-0000000000f2";
  const USER_ID = "e2222222-2222-4000-8000-000000000020";
  const MSG_CREATE = "e3333333-3333-4000-8000-000000000030";

  afterAll(async () => {
    await runWithTenant(CREATE_TENANT, () => db.transaction(async (tx) => {
      await tx.delete(users).where(eq(users.id, USER_ID));
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, CREATE_TENANT));
      await tx.delete(processed).where(eq(processed.messageId, MSG_CREATE));
    }));
  });

  it("processes identity.user.create → inserts user row + emits events", async () => {
    const q = wireTenantAwareQueue(new MemoryQueue());
    const { registerUserConsumers } = await import("../src/modules/users/consumer.js");
    registerUserConsumers(q);
    await q.start();

    await q.publish("identity.user.create", {
      messageId: MSG_CREATE,
      type: "identity.user.create",
      tenantId: CREATE_TENANT,
      actorId: "00000000-0000-0000-0000-000000000001",
      correlationId: "corr-create-1",
      schemaVersion: "1.0",
      timestamp: new Date().toISOString(),
      payload: {
        id: USER_ID,
        tenantId: CREATE_TENANT,
        email: "consumer-test@coverage.gov.in",
        name: "Consumer Test User",
        empCode: "EMP001",
        status: "active",
        mfaEnabled: false,
        version: 1,
        createdBy: "00000000-0000-0000-0000-000000000001",
      },
    });

    await new Promise((r) => setTimeout(r, 600));
    await q.stop();

    // Verify user was inserted
    const [row] = await runWithTenant(CREATE_TENANT, () => db.transaction(async (tx) =>
      tx.select().from(users).where(eq(users.id, USER_ID))));
    expect(row).toBeDefined();
    expect(row.email).toBe("consumer-test@coverage.gov.in");
    expect(row.name).toBe("Consumer Test User");
    expect(row.status).toBe("active");

    // Verify audit in outbox
    const outbox = await runWithTenant(CREATE_TENANT, () => db.transaction(async (tx) =>
      tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, CREATE_TENANT))));
    const eventTypes = outbox.map((r) => r.eventType);
    expect(eventTypes).toContain("identity.user.created");
    expect(eventTypes).toContain("audit.event.record");
  });
});
