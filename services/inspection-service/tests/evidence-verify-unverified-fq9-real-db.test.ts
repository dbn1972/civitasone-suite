/**
 * UAT FQ9 #25: POST /v1/inspection/evidence/:id/verify was accepted but integrity_status never
 * changed. When the stored object cannot be re-hashed (storage unconfigured / unretrievable) the
 * consumer records 'unverified' — by design it never asserts 'valid' without proof — but 0007's
 * CHECK only admitted valid|tampered, so the verify died on evidence_artifacts_integrity_status_check.
 * Given a 'valid' artifact and no retrievable object, When verify-integrity is handled, Then the
 * artifact is 'unverified' and a 'verify' custody entry is recorded.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import type { Queue } from "@civitasone/queue";
import { db, sqlClient } from "../src/shared/db.js";
import { registerEvidenceConsumers } from "../src/modules/evidence/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "f9b00000-0000-4000-8000-000000000025";
const ACTOR = randomUUID();
const EVIDENCE = randomUUID();
const handlers = new Map<string, (msg: unknown) => Promise<void>>();

beforeAll(async () => {
  registerEvidenceConsumers({ subscribe: (t: string, h: (m: unknown) => Promise<void>) => handlers.set(t, h) } as unknown as Queue);
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.execute(sql`
      INSERT INTO evidence.evidence_artifacts
        (id, tenant_id, inspection_id, sha256_hash, s3_key, mime_type, file_size_bytes,
         integrity_status, capture_timestamp, device_id, inspector_id, created_by)
      VALUES (${EVIDENCE}, ${TENANT}, ${randomUUID()}, ${"ab".repeat(32)}, ${"fq9/missing-object"},
              'image/jpeg', 10, 'valid', now(), 'fq9-device', ${ACTOR}, ${ACTOR})`);
  }));
});

afterAll(async () => { await sqlClient.end(); });

describe("evidence verify-integrity without a retrievable object (UAT FQ9 #25)", () => {
  it("marks the artifact 'unverified' and records the verification in the chain of custody", async () => {
    await runWithTenant(TENANT, () => handlers.get(COMMANDS.evidenceVerifyIntegrity)!({
      messageId: randomUUID(), type: COMMANDS.evidenceVerifyIntegrity, tenantId: TENANT, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { evidenceId: EVIDENCE, tenantId: TENANT },
    }));

    const result = await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      const a = await tx.execute(sql`SELECT integrity_status FROM evidence.evidence_artifacts WHERE id = ${EVIDENCE}`);
      const c = await tx.execute(sql`SELECT action, details FROM evidence.chain_of_custody WHERE evidence_id = ${EVIDENCE}`);
      return { a: a as unknown as Array<{ integrity_status: string }>, c: c as unknown as Array<{ action: string; details: { integrityStatus: string } }> };
    }));
    expect(result.a[0]?.integrity_status).toBe("unverified");
    expect(result.c.map((r) => r.action)).toContain("verify");
    expect(result.c.find((r) => r.action === "verify")?.details.integrityStatus).toBe("unverified");
  });
});
