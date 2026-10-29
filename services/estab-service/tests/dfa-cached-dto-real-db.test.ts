/**
 * UAT FQ9 #18 / #38: POST /v1/estab/dfa/:id/approve and /sign returned 500
 * ("r.createdAt.toISOString is not a function") once the DFA had been read before.
 * getDfa() reads through the cache, which is a JSON round-trip, so a warm read hands toDto() a row
 * whose timestamps are ISO strings, not Dates.
 * Given a DFA whose cache entry is warm, When a different approver approves / signs it, Then the
 * route answers 202 (not 500) and the DTO timestamps are ISO strings.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { estabDfa, estabDfaVersion } from "../src/modules/dfa/schema.js";
import { insertDfa } from "../src/modules/dfa/repo.js";
import { formatDfaNo } from "../src/modules/dfa/domain.js";
import { getDfa } from "../src/modules/dfa/queries.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "61111111-aaaa-4000-8000-0000000000f9";
const DRAFTER = "00000000-eeee-4000-8000-0000000000f1";
const APPROVER = "00000000-eeee-4000-8000-0000000000f2";

function auth(actor: string, roles: string[]) {
  const token = signToken({ sub: actor, tid: TENANT, roles, sid: "sess-fq9-dfa" }, SECRET, 3600);
  return { authorization: `Bearer ${token}`, "x-tenant-id": TENANT };
}

async function clean() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.delete(estabDfaVersion).where(eq(estabDfaVersion.tenantId, TENANT));
      await tx.delete(estabDfa).where(eq(estabDfa.tenantId, TENANT));
    }),
  );
}

async function seed(status: string): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, () =>
    db.transaction((tx) =>
      insertDfa(tx, {
        id, tenantId: TENANT, dfaNo: formatDfaNo("order", 2026, 9),
        fileId: null, communicationType: "order", templateCode: null,
        subject: "Sanction", body: "Body", recipientEmployeeId: null,
        recipientName: null, recipientAddress: null,
        status, createdBy: DRAFTER, updatedBy: DRAFTER,
      }),
    ),
  );
  return id;
}

beforeEach(clean);
afterAll(async () => { await clean(); await sqlClient.end(); });

describe("DFA DTO from a warm cache (UAT FQ9 #18/#38)", () => {
  it("getDfa returns ISO timestamps on both a cold and a warm read", async () => {
    const id = await seed("pending_approval");
    const cold = await runWithTenant(TENANT, () => getDfa(TENANT, id));
    const warm = await runWithTenant(TENANT, () => getDfa(TENANT, id));
    expect(warm).toEqual(cold);
    expect(warm?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    expect(warm?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it("approve by a different approver after the DFA was read is 202, not 500", async () => {
    const id = await seed("pending_approval");
    const app = await buildApp();
    // First read warms the cache (the drafter's own attempt is refused synchronously).
    const own = await app.inject({ method: "POST", url: `/v1/estab/dfa/${id}/approve`, headers: auth(DRAFTER, ["estab_admin"]), payload: {} });
    const res = await app.inject({ method: "POST", url: `/v1/estab/dfa/${id}/approve`, headers: auth(APPROVER, ["estab_admin"]), payload: {} });
    await app.close();
    expect(own.statusCode).toBe(403);
    expect(res.statusCode).toBe(202);
  });

  it("sign by a different signer after the DFA was read is 202, not 500", async () => {
    const id = await seed("approved");
    const app = await buildApp();
    const own = await app.inject({ method: "POST", url: `/v1/estab/dfa/${id}/sign`, headers: auth(DRAFTER, ["estab_admin"]) });
    const res = await app.inject({ method: "POST", url: `/v1/estab/dfa/${id}/sign`, headers: auth(APPROVER, ["estab_admin"]) });
    await app.close();
    expect(own.statusCode).toBe(403);
    expect(res.statusCode).toBe(202);
  });
});
