/**
 * GAP-ESTAB-DFA-02 — segregation of duties on DFA approve/sign is enforced at
 * the route, synchronously: the drafter gets a 403 MAKER_CHECKER_VIOLATION and
 * nothing is enqueued (the DFA stays put). A different approver is accepted
 * (202), and a non-approver role is rejected (403) regardless of identity.
 * The list/get payload carries createdBy so the UI can hide the buttons.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { estabDfa, estabDfaVersion } from "../src/modules/dfa/schema.js";
import { insertDfa, findDfaById } from "../src/modules/dfa/repo.js";
import { formatDfaNo } from "../src/modules/dfa/domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "61111111-aaaa-4000-8000-0000000000d1";
const DRAFTER = "00000000-eeee-4000-8000-0000000000d1";
const OTHER_APPROVER = "00000000-eeee-4000-8000-0000000000d2";

function auth(actor: string, roles: string[]) {
  const token = signToken({ sub: actor, tid: TENANT, roles, sid: "sess-dfa02" }, SECRET, 3600);
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
        id, tenantId: TENANT, dfaNo: formatDfaNo("order", 2026, 1),
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

describe("DFA approve/sign maker-checker at the route (GAP-ESTAB-DFA-02)", () => {
  it("403s the drafter approving their own DFA and leaves it pending_approval", async () => {
    const id = await seed("pending_approval");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/estab/dfa/${id}/approve`,
      headers: auth(DRAFTER, ["estab_admin"]), payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("MAKER_CHECKER_VIOLATION");
    const row = await runWithTenant(TENANT, () => findDfaById(id, TENANT));
    expect(row?.status).toBe("pending_approval");
  });

  it("403s the drafter signing their own approved DFA", async () => {
    const id = await seed("approved");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/estab/dfa/${id}/sign`,
      headers: auth(DRAFTER, ["estab_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("MAKER_CHECKER_VIOLATION");
  });

  it("accepts a different approver (202)", async () => {
    const id = await seed("pending_approval");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/estab/dfa/${id}/approve`,
      headers: auth(OTHER_APPROVER, ["estab_admin"]), payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("403s a non-approver role even when it is not the drafter", async () => {
    const id = await seed("pending_approval");
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/estab/dfa/${id}/approve`,
      headers: auth(OTHER_APPROVER, ["estab_officer"]), payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("exposes createdBy on the list payload", async () => {
    await seed("pending_approval");
    const app = await buildApp();
    const res = await app.inject({
      method: "GET", url: "/v1/estab/dfa?limit=10",
      headers: auth(OTHER_APPROVER, ["estab_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].createdBy).toBe(DRAFTER);
  });
});
