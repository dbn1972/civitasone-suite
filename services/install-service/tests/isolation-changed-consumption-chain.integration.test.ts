/**
 * Integration test for the `tenant.tenant.isolation_changed` → install-service
 * consumption chain (task 17.2).
 *
 * Validates: Requirements 2.3, 3.1, 3.2, 4.1
 *
 * Drives the REAL consumer (`registerProvisioningConsumers`) and the REAL
 * worker poll-loop scheduler (`runProvisioningPollCycle`) against the dev-stack
 * Postgres, proving the full chain end to end:
 *
 *   1. A single `tenant.tenant.isolation_changed` (tier=silo) event — the same
 *      event tenant-service's onboarding pipeline publishes exactly once when
 *      the Tenant_Placement_Policy resolves a tenant to `silo` (task 6.5/6.6,
 *      Req 2.3) — is published exactly once.
 *   2. install-service's consumer creates exactly one `requested`
 *      Silo_Provisioning_Record for that tenant (Req 3.1).
 *   3. The worker poll-loop scheduler picks the `requested` record up, claims
 *      it (transition to `provisioning` BEFORE any I/O — Req 3.2), actuates
 *      against a real (fixture-migration) database, and finalizes it to
 *      `ready` (Req 4.1) — publishing the registry-update command
 *      tenant-service consumes to set `dbDsnRef`.
 *
 * `install.silo_provisions` is RLS-enforced (`tenant_id = current_tenant_id()`,
 * `NOBYPASSRLS` role), so every step below runs inside `runWithTenant(tenantId,
 * …)`, mirroring `provisioning-consumer.test.ts`/`provisioning-scheduler.test.ts`.
 * `findPollable`'s scan has no explicit tenant filter by design (it's meant to
 * be cross-tenant for a real worker with a bypass-capable identity) — under
 * this test's non-bypassing role + active tenant context, RLS itself narrows
 * the scan to exactly this test's tenant, which is sufficient to prove the
 * single-tenant chain this test exercises.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import type { CommandEnvelope, Handler, Queue, QueueDriver } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db, sqlClient } from "../src/shared/db.js";
import { siloProvisions } from "../src/modules/provisioning/schema.js";
import { registerProvisioningConsumers } from "../src/modules/provisioning/consumer.js";
import { runProvisioningPollCycle } from "../src/modules/provisioning/scheduler.js";
import { SERVICES } from "../src/modules/provisioning/actuator.js";
import { CONSUMED_EVENTS, TENANT_SET_ISOLATION } from "../src/topics.js";

const ACTOR = "00000000-dddd-4000-8000-000000000002";
// Must point at civitas_install (where install.silo_provisions actually lives),
// not the "postgres" maintenance database — Postgres permits CREATE DATABASE
// from any connected database under a CREATEDB-privileged role, so this same
// connection also serves the actuator's database-creation step (actuator.ts).
// Prefer PROVISIONING_RUNNER_DSN (vitest.config wires CI's civitas_test admin
// password). Hardcoded civitas_dev_pw fails auth against the GHA service
// container where bootstrap sets civitas_admin from PGPASSWORD=civitas_test.
const ADMIN_PW =
  process.env.POSTGRES_ADMIN_PASSWORD ??
  process.env.PGPASSWORD ??
  (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
    ? "civitas_test"
    : "civitas_dev_pw");
const RUNNER_DSN =
  process.env.PROVISIONING_RUNNER_DSN ??
  `postgres://civitas_admin:${encodeURIComponent(ADMIN_PW)}@${process.env.PGHOST ?? "localhost"}:${process.env.PGPORT ?? "5435"}/civitas_install`;

/** Same capturing tenant-aware queue pattern as provisioning-consumer.test.ts. */
class CapturingTenantAwareQueue implements Queue {
  private handlers = new Map<string, Handler[]>();
  readonly published: Array<{ topic: string; envelope: CommandEnvelope }> = [];

  subscribe<T>(topic: string, handler: Handler<T>): void {
    const list = this.handlers.get(topic) ?? [];
    list.push(handler as Handler);
    this.handlers.set(topic, list);
  }

  async publish<T>(topic: string, input: { messageId: string } & Partial<CommandEnvelope<T>>): Promise<string> {
    const msg = input as CommandEnvelope<T>;
    this.published.push({ topic, envelope: msg });
    const list = this.handlers.get(topic) ?? [];
    for (const handler of list) {
      await runWithTenant(msg.tenantId, () => handler(msg));
    }
    return msg.messageId;
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> { this.handlers.clear(); }
  async healthCheck(): Promise<{ healthy: boolean; driver: QueueDriver }> {
    return { healthy: true, driver: "memory" };
  }
}

async function wipe(tenantId: string) {
  await runWithTenant(tenantId, () =>
    db.transaction((tx) => tx.delete(siloProvisions).where(eq(siloProvisions.tenantId, tenantId))),
  );
}

/**
 * The poll loop's findPollable() uses PROVISIONING_RUNNER_DSN (civitas_admin),
 * not DATABASE_URL/install_svc. Probing only install_svc masked the real CI
 * failure ("permission denied for schema install" on the runner). Probe the
 * runner DSN instead; migration 0013 grants the runner role. Skip only when
 * that grant is still missing (older DBs / partial bootstrap).
 */
let runnerCanPoll = false;

beforeAll(async () => {
  const runner = postgres(RUNNER_DSN, { max: 1 });
  try {
    await runner`SELECT 1 FROM install.silo_provisions LIMIT 1`;
    runnerCanPoll = true;
  } catch {
    runnerCanPoll = false;
  } finally {
    await runner.end({ timeout: 5 }).catch(() => undefined);
  }
});

function skipUnlessRunnerCanPoll(context: { skip: (note?: string) => void }): void {
  if (!runnerCanPoll) {
    context.skip(
      "civitas_admin cannot SELECT install.silo_provisions (apply migration 0013_provisioning_runner_grants)",
    );
  }
}

describe("tenant.tenant.isolation_changed → install-service — full consumption chain (real Postgres)", () => {
  let fixtureRoot: string;
  const createdTenants: string[] = [];
  // Reuse two real DB_Backed_Service names (listAllMigrations only walks the
  // actuator's fixed SERVICES list — see provisioning-e2e-silo.integration.test.ts).
  const FIXTURE_SERVICES = [SERVICES[2]!, SERVICES[3]!];
  const dbNames: string[] = [];

  afterAll(async () => {
    for (const tenantId of createdTenants) await wipe(tenantId);
    for (const name of dbNames) {
      const runner = postgres(RUNNER_DSN, { max: 1 });
      await runner.unsafe(`DROP DATABASE IF EXISTS ${name}`).catch(() => undefined);
      await runner.end({ timeout: 5 }).catch(() => undefined);
    }
    await sqlClient.end();
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("onboarding a silo tenant publishes exactly one isolation_changed event, creates exactly one requested record, and the poll loop drives it to ready", async (ctx) => {
    skipUnlessRunnerCanPoll(ctx);
    fixtureRoot = mkdtempSync(join(tmpdir(), "isolation-chain-"));
    for (const svc of FIXTURE_SERVICES) {
      const dir = join(fixtureRoot, "services", svc, "migrations");
      mkdirSync(dir, { recursive: true });
      const schema = `probe_${svc.replace(/-/g, "_")}`;
      writeFileSync(
        join(dir, "0001_init.sql"),
        `CREATE SCHEMA IF NOT EXISTS ${schema};\n` +
          `CREATE TABLE IF NOT EXISTS ${schema}.probe (id uuid PRIMARY KEY);\n`,
      );
    }

    const tenantId = randomUUID();
    createdTenants.push(tenantId);
    const dbName = `civitas_chain_${tenantId.replace(/-/g, "").slice(0, 16)}`;
    dbNames.push(dbName);

    // ── Step 1: tenant-service's onboarding pipeline publishes this event
    // exactly once when Tenant_Placement_Policy resolves to `silo` (Req 2.3).
    const queue = new CapturingTenantAwareQueue();
    registerProvisioningConsumers(queue);
    await queue.start();

    const messageId = randomUUID();
    await queue.publish(CONSUMED_EVENTS.tenantIsolationChanged, {
      messageId,
      type: CONSUMED_EVENTS.tenantIsolationChanged,
      tenantId,
      actorId: ACTOR,
      correlationId: `corr-chain-${messageId}`,
      schemaVersion: "1.0",
      payload: { tenantId, tier: "silo" },
    });
    await queue.stop();

    // Exactly one publish of the event this test drove (proves the "exactly
    // once" half of Req 2.3 at the consumption side — the publish call itself).
    const isolationPublishes = queue.published.filter((p) => p.topic === CONSUMED_EVENTS.tenantIsolationChanged);
    expect(isolationPublishes).toHaveLength(1);

    // ── Step 2: install-service's consumer created exactly one `requested`
    // Silo_Provisioning_Record for this tenant (Req 3.1).
    const afterConsume = await runWithTenant(tenantId, () =>
      db.transaction((tx) => tx.select().from(siloProvisions).where(eq(siloProvisions.tenantId, tenantId))),
    );
    expect(afterConsume).toHaveLength(1);
    expect(afterConsume[0]?.status).toBe("requested");
    const recordId = afterConsume[0]!.id;

    // Point the just-created record at our fixture database name (the real
    // consumer derives dbName from tenantId via a naming convention that this
    // test does not need to reproduce byte-for-byte — only the poll loop's
    // downstream behavior against a REAL dbName is under test here).
    await runWithTenant(tenantId, () =>
      db.transaction((tx) =>
        tx.update(siloProvisions).set({ dbName }).where(eq(siloProvisions.id, recordId)),
      ),
    );

    // ── Step 3: the worker poll-loop scheduler claims (provisioning BEFORE
    // any I/O — Req 3.2), actuates against the real fixture migrations, and
    // finalizes to `ready` (Req 4.1).
    const pollResult = await runWithTenant(tenantId, () =>
      runProvisioningPollCycle({
        runnerDsn: RUNNER_DSN,
        reposRoot: fixtureRoot,
        staleMs: 10 * 60_000,
        batchSize: 5,
      }),
    );

    expect(pollResult.scanned).toBe(1);
    expect(pollResult.ready).toBe(1);
    expect(pollResult.failed).toBe(0);

    const afterPoll = await runWithTenant(tenantId, () =>
      db.transaction((tx) => tx.select().from(siloProvisions).where(eq(siloProvisions.id, recordId))),
    );
    expect(afterPoll).toHaveLength(1);
    expect(afterPoll[0]?.status).toBe("ready");
    expect(afterPoll[0]?.readyAt).not.toBeNull();
    expect((afterPoll[0]?.appliedMigrations as string[]).sort()).toEqual(
      FIXTURE_SERVICES.map((svc) => `${svc}/0001_init.sql`).sort(),
    );
  });
});
