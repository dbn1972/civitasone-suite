/**
 * config-registry — consumer + repo + policy-getter integration tests (real DB).
 *
 * Drives the config command handlers directly under runWithTenant(TENANT, …) (sets
 * the app.tenant_id GUC for RLS, exactly as the worker's router does), then reads
 * back through the repo + typed policy getters. Also exercises the HTTP routes
 * (RBAC + 202) via app.inject().
 *
 * The headline assertion is the TENANT-DIFFERENTIATED proof: tenant A's override
 * changes its resolved policy value while tenant B (unconfigured) still resolves the
 * hardcoded default — behavior-preserving migration + real tenant isolation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { CommandEnvelope } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { COMMANDS } from "../src/topics.js";
import { registerConfigRegistryConsumers } from "../src/modules/config-registry/consumer.js";
import { deriveConfigId } from "../src/modules/config-registry/domain.js";
import { getPolicyNumber, getAllowedCommitteeTypes, POLICY_NS, COMMITTEE_TYPES_NS } from "../src/modules/config-registry/policy.js";
import * as repo from "../src/modules/config-registry/repo.js";

const TENANT_A = "a0000000-0000-4000-8000-0000000c0f16";
const TENANT_B = "b0000000-0000-4000-8000-0000000c0f16";
const ACTOR = "90000000-0000-4000-8000-0000000c0f16";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const handlers = new Map<string, (msg: CommandEnvelope<any>) => Promise<void>>();
registerConfigRegistryConsumers((topic, h) => handlers.set(topic, h as any));

function msg<T>(type: string, payload: T, messageId = randomUUID()): CommandEnvelope<T> {
  return { messageId, type, tenantId: TENANT_A, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload } as CommandEnvelope<T>;
}

function runAs<T>(tenant: string, m: CommandEnvelope<T>): Promise<void> {
  const handler = handlers.get(m.type);
  if (!handler) throw new Error(`no handler for ${m.type}`);
  return runWithTenant(tenant, () => handler({ ...m, tenantId: tenant })) as Promise<void>;
}

/** setConfig via the consumer (id derived exactly as commands.ts / presets.ts do). */
function setConfig(tenant: string, namespace: string, configKey: string, value: unknown, expectedVersion?: number, messageId = randomUUID()): Promise<void> {
  const id = deriveConfigId(tenant, namespace, configKey);
  return runAs(tenant, msg(COMMANDS.setConfig, { id, tenantId: tenant, namespace, configKey, value, expectedVersion }, messageId));
}

/** A stable messageId for the create so the redelivery test can replay it. */
const CREATE_MID = randomUUID();

async function query<T = any>(tenant: string, fn: (sql: typeof sqlClient) => Promise<T>): Promise<T> {
  return runWithTenant(tenant, () =>
    sqlClient.begin(async (sql) => {
      await sql`select set_config('app.tenant_id', ${tenant}, true)`;
      return fn(sql as unknown as typeof sqlClient);
    }),
  ) as Promise<T>;
}

async function cleanup(): Promise<void> {
  for (const t of [TENANT_A, TENANT_B]) {
    await query(t, (sql) => sql`delete from meeting.config_entries where tenant_id = ${t}`);
  }
}

let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  await cleanup();
  app = await buildApp();
});

afterAll(async () => {
  if (app) await app.close();
  await cleanup();
  await sqlClient.end();
});

// ─── Consumer + repo + typed getters ────────────────────────────────────────────

describe("config-registry consumer + policy getters", () => {
  it("create → tenant A override resolves; tenant B still gets the default (differentiated)", async () => {
    await setConfig(TENANT_A, POLICY_NS, "agenda.submission_deadline_days", 3, undefined, CREATE_MID);

    // DB row: version 1, value 3.
    const rows = await query(TENANT_A, (sql) => sql`
      select value, version, active from meeting.config_entries
      where tenant_id = ${TENANT_A} and namespace = ${POLICY_NS} and config_key = 'agenda.submission_deadline_days'`);
    expect(rows.length).toBe(1);
    expect(Number(rows[0].value)).toBe(3);
    expect(rows[0].version).toBe(1);

    // Typed getter: A resolves the override, B resolves the literal default (7).
    const a = await runWithTenant(TENANT_A, () => db.transaction((tx) => getPolicyNumber(tx, TENANT_A, "agenda.submission_deadline_days")));
    const b = await runWithTenant(TENANT_B, () => db.transaction((tx) => getPolicyNumber(tx, TENANT_B, "agenda.submission_deadline_days")));
    expect(a).toBe(3);
    expect(b).toBe(7);
  });

  it("redelivery with the same messageId is an idempotent no-op", async () => {
    const id = deriveConfigId(TENANT_A, POLICY_NS, "agenda.submission_deadline_days");
    // Same messageId as the create above → markProcessed short-circuits.
    await runAs(TENANT_A, msg(COMMANDS.setConfig, { id, tenantId: TENANT_A, namespace: POLICY_NS, configKey: "agenda.submission_deadline_days", value: 999 }, CREATE_MID));
    const rows = await query(TENANT_A, (sql) => sql`
      select value, version from meeting.config_entries where id = ${id}`);
    expect(Number(rows[0].value)).toBe(3); // unchanged
    expect(rows[0].version).toBe(1);
  });

  it("version-guarded update bumps version; a stale expectedVersion is a NonRetryableError", async () => {
    await setConfig(TENANT_A, POLICY_NS, "agenda.submission_deadline_days", 5, 1);
    const rows = await query(TENANT_A, (sql) => sql`
      select value, version from meeting.config_entries
      where tenant_id = ${TENANT_A} and namespace = ${POLICY_NS} and config_key = 'agenda.submission_deadline_days'`);
    expect(Number(rows[0].value)).toBe(5);
    expect(rows[0].version).toBe(2);

    await expect(setConfig(TENANT_A, POLICY_NS, "agenda.submission_deadline_days", 8, 1))
      .rejects.toThrow(/VERSION_CONFLICT/);
  });

  it("deactivate soft-retires the entry (active=false)", async () => {
    const id = deriveConfigId(TENANT_A, POLICY_NS, "agenda.submission_deadline_days");
    await runAs(TENANT_A, msg(COMMANDS.deactivateConfig, { configId: id, tenantId: TENANT_A, expectedVersion: 2 }));
    const rows = await query(TENANT_A, (sql) => sql`select active from meeting.config_entries where id = ${id}`);
    expect(rows[0].active).toBe(false);
  });

  it("unconfigured key always resolves the literal default", async () => {
    const v = await runWithTenant(TENANT_B, () => db.transaction((tx) => getPolicyNumber(tx, TENANT_B, "minutes.submission_deadline_days")));
    expect(v).toBe(7);
  });

  it("effectiveAllowed committee types: configured set REPLACES the default", async () => {
    await setConfig(TENANT_A, COMMITTEE_TYPES_NS, "statutory", { allowed: true });
    await setConfig(TENANT_A, COMMITTEE_TYPES_NS, "standing", { allowed: true });
    const a = await runWithTenant(TENANT_A, () => db.transaction((tx) => getAllowedCommitteeTypes(tx, TENANT_A)));
    expect([...a].sort()).toEqual(["standing", "statutory"]);
    // Unconfigured tenant B keeps the full default vocabulary.
    const b = await runWithTenant(TENANT_B, () => db.transaction((tx) => getAllowedCommitteeTypes(tx, TENANT_B)));
    expect([...b].sort()).toEqual(["ad_hoc", "board", "standing", "statutory"]);
  });

  it("repo.listByNamespace returns the tenant's active entries", async () => {
    const items = await runWithTenant(TENANT_A, () => repo.listByNamespace(TENANT_A, COMMITTEE_TYPES_NS, true));
    expect(items.map((i) => i.configKey).sort()).toEqual(["standing", "statutory"]);
  });
});

// ─── HTTP routes (RBAC + 202) ────────────────────────────────────────────────────

describe("config-registry routes", () => {
  const token = (roles: string[], tid = TENANT_A): string => signToken({ sub: ACTOR, tid, roles, sid: "sess-cfg" }, SECRET);
  const body = { namespace: POLICY_NS, configKey: "agenda.submission_deadline_days", value: 4 };

  it("401 when unauthenticated", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/meetings/config", payload: body });
    expect(res.statusCode).toBe(401);
  });

  it("403 for a non-admin role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/meetings/config",
      headers: { authorization: `Bearer ${token(["committee_member"])}` }, payload: body,
    });
    expect(res.statusCode).toBe(403);
  });

  it("202 for tenant_admin write", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/meetings/config",
      headers: { authorization: `Bearer ${token(["tenant_admin"])}` }, payload: body,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().configId).toBe(deriveConfigId(TENANT_A, POLICY_NS, "agenda.submission_deadline_days"));
  });

  it("200 list namespace for meeting_admin read", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/meetings/config/${POLICY_NS}`,
      headers: { authorization: `Bearer ${token(["meeting_admin"])}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("items");
  });

  it("400 for an unknown preset", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/meetings/config/presets/does-not-exist",
      headers: { authorization: `Bearer ${token(["tenant_admin"])}` }, payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
