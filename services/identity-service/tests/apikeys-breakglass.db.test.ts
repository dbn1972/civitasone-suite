import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";

// DB-gated integration tests. Skipped unless a reachable identity DB is present.
// Run on the box where civitas_identity exists (migrations 0001..0011 applied).
const RUN_DB = process.env.DATABASE_URL ?? process.env.DB_URL;

const TENANT_A = "00000000-0000-0000-0000-000000000001";
const TENANT_B = "00000000-0000-0000-0000-0000000000b2";

function ctx(tenantId: string, roles: string[]): RequestContext {
  return {
    tenantId, actorId: randomUUID(), actorType: "user", roles,
    correlationId: randomUUID(),
  };
}

describe.skipIf(!RUN_DB)("api-keys + break-glass — DB integration", () => {
  let apiCmd: typeof import("../src/modules/apikeys/commands.js");
  let bgCmd: typeof import("../src/modules/breakglass/commands.js");
  let bgRepo: typeof import("../src/modules/breakglass/repo.js");
  let bgQ: typeof import("../src/modules/breakglass/queries.js");
  let sqlClient: any;

  beforeAll(async () => {
    apiCmd = await import("../src/modules/apikeys/commands.js");
    bgCmd = await import("../src/modules/breakglass/commands.js");
    bgRepo = await import("../src/modules/breakglass/repo.js");
    bgQ = await import("../src/modules/breakglass/queries.js");
    ({ sqlClient } = await import("../src/shared/db.js"));
  });

  // ── API-KEY lifecycle ─────────────────────────────────────────────────────
  it("issues a usable key, returns plaintext once, and verifies in-scope", async () => {
    const c = ctx(TENANT_A, ["tenant_admin"]);
    const issued = await apiCmd.issueApiKey(c, { name: "svc-A", scopes: ["users:read", "rbac:*"] });
    expect(issued.key.startsWith(issued.keyPrefix + ".")).toBe(true);
    expect(issued.status).toBe("active");

    const ok = await apiCmd.verifyApiKey(issued.key, "users:read");
    expect(ok.valid).toBe(true);
    expect(ok.tenantId).toBe(TENANT_A);

    const wildcard = await apiCmd.verifyApiKey(issued.key, "rbac:write");
    expect(wildcard.valid).toBe(true);
  });

  it("DENIES an out-of-scope verification (403/OUT_OF_SCOPE)", async () => {
    const c = ctx(TENANT_A, ["tenant_admin"]);
    const issued = await apiCmd.issueApiKey(c, { name: "svc-readonly", scopes: ["users:read"] });
    const denied = await apiCmd.verifyApiKey(issued.key, "users:write");
    expect(denied.valid).toBe(false);
    expect(denied.reason).toMatch(/scope/);
  });

  it("rotation invalidates the previous secret immediately and bumps key_version", async () => {
    const c = ctx(TENANT_A, ["tenant_admin"]);
    const issued = await apiCmd.issueApiKey(c, { name: "svc-rotate", scopes: ["users:read"] });
    const oldKey = issued.key;

    const rotated = await apiCmd.rotateApiKey(c, issued.id, "scheduled rotation");
    expect(rotated.keyVersion).toBe(2);
    expect(rotated.key).not.toBe(oldKey);

    const oldNowInvalid = await apiCmd.verifyApiKey(oldKey, "users:read");
    expect(oldNowInvalid.valid).toBe(false);
    const newWorks = await apiCmd.verifyApiKey(rotated.key, "users:read");
    expect(newWorks.valid).toBe(true);
  });

  it("revocation is terminal and idempotent; revoked key cannot verify", async () => {
    const c = ctx(TENANT_A, ["tenant_admin"]);
    const issued = await apiCmd.issueApiKey(c, { name: "svc-revoke", scopes: ["users:read"] });
    const r1 = await apiCmd.revokeApiKey(c, issued.id, "compromised");
    expect(r1.status).toBe("revoked");
    const r2 = await apiCmd.revokeApiKey(c, issued.id); // idempotent
    expect(r2.status).toBe("revoked");
    const denied = await apiCmd.verifyApiKey(issued.key, "users:read");
    expect(denied.valid).toBe(false);
  });

  it("a tenant-A key never verifies as tenant-B (tenant isolation at boundary)", async () => {
    const c = ctx(TENANT_A, ["tenant_admin"]);
    const issued = await apiCmd.issueApiKey(c, { name: "svc-iso", scopes: ["users:read"] });
    const res = await apiCmd.verifyApiKey(issued.key, "users:read");
    expect(res.valid).toBe(true);
    expect(res.tenantId).toBe(TENANT_A);
    // The route layer rejects when res.tenantId !== caller tenant; assert the
    // distinguishing field is present so that guard is enforceable.
    expect(res.tenantId).not.toBe(TENANT_B);
  });

  // ── BREAK-GLASS lifecycle ──────────────────────────────────────────────────
  it("grants a break-glass, enforces ONE active per (tenant,user), closes idempotently", async () => {
    const c = ctx(TENANT_A, ["super_admin"]);
    const userId = randomUUID();
    const g = await bgCmd.grant(c, { userId, reason: "prod incident #4821 firefight", scope: "payroll.admin", ttlMinutes: 30 });
    expect(g.status).toBe("active");

    // second concurrent open for same user → 409 BREAK_GLASS_ALREADY_ACTIVE
    await expect(
      bgCmd.grant(c, { userId, reason: "second attempt same user incident", scope: "payroll.admin", ttlMinutes: 30 }),
    ).rejects.toMatchObject({ status: 409, code: "BREAK_GLASS_ALREADY_ACTIVE" });

    const closed = await bgCmd.close(c, g.id, "incident resolved");
    expect(closed.status).toBe("closed");
    // idempotent close
    const closedAgain = await bgCmd.close(c, g.id);
    expect(closedAgain.status).toBe("closed");

    // after close, a fresh grant for the same user is allowed again
    const g2 = await bgCmd.grant(c, { userId, reason: "follow-up incident work next day", scope: "payroll.admin", ttlMinutes: 10 });
    expect(g2.status).toBe("active");
    await bgCmd.close(c, g2.id);
  });

  it("TTL sweep expires an active grant whose expiry has passed", async () => {
    const c = ctx(TENANT_A, ["super_admin"]);
    const userId = randomUUID();
    const g = await bgCmd.grant(c, { userId, reason: "ttl sweep coverage incident", scope: "db.admin", ttlMinutes: 5 });

    // force expiry into the past to exercise the sweep deterministically
    await sqlClient`UPDATE breakglass.grants SET expires_at = now() - interval '1 minute' WHERE id = ${g.id}`;

    // a read presents it as expired even before the sweep flips it
    const preSweep = await bgQ.getGrant(TENANT_A, g.id);
    expect(preSweep?.status).toBe("expired");

    const swept = await bgRepo.sweepExpiredGrants();
    expect(swept).toBeGreaterThanOrEqual(1);

    const postSweep = await bgQ.getGrant(TENANT_A, g.id);
    expect(postSweep?.status).toBe("expired");
  });

  it("break-glass grants are tenant-isolated in listing", async () => {
    const ca = ctx(TENANT_A, ["super_admin"]);
    const cb = ctx(TENANT_B, ["super_admin"]);
    const ga = await bgCmd.grant(ca, { userId: randomUUID(), reason: "tenant A isolation check incident", scope: "x.admin", ttlMinutes: 10 });
    const gb = await bgCmd.grant(cb, { userId: randomUUID(), reason: "tenant B isolation check incident", scope: "x.admin", ttlMinutes: 10 });

    const aList = await bgQ.listGrants(TENANT_A, undefined, 200, 0);
    const bIdsInA = aList.filter((x) => x.id === gb.id);
    expect(bIdsInA).toHaveLength(0);
    expect(aList.some((x) => x.id === ga.id)).toBe(true);

    // tenant B cannot read tenant A's grant by id
    const crossRead = await bgQ.getGrant(TENANT_B, ga.id);
    expect(crossRead).toBeNull();

    await bgCmd.close(ca, ga.id);
    await bgCmd.close(cb, gb.id);
  });
});
