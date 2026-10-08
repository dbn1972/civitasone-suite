/**
 * GAP2-ESTAB-NOTIFICATIONS-DFALINK-01 — DFA notification deep-links must point
 * at a REACHABLE route. There is no /estab/dfa/[id] detail page, so the old
 * `/estab/dfa/<uuid>` links 404'd on every click. The feed now links to
 * `/estab/dfa?focus=<id>` (the DFA list route honours ?focus=).
 *
 * Fails on the old notifications/queries.ts (which emitted `/estab/dfa/<id>`).
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { estabDfa } from "../src/modules/dfa/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "0f1a5e00-4000-4000-8000-000000000931";
const ACTOR = "0f1a5e00-5000-4000-8000-000000000931";
const PENDING_DFA = "0f1a5e00-7000-4000-8000-000000000931";
const SIGNED_DFA = "0f1a5e00-7000-4000-8000-000000000932";

function authHeader(roles = ["estab_officer", "super_admin"]) {
  const token = signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-dfalink-931" }, SECRET, 3600);
  return { authorization: `Bearer ${token}` };
}

async function cleanup() {
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(estabDfa).where(eq(estabDfa.tenantId, TENANT))));
}

beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("GAP2-ESTAB-NOTIFICATIONS-DFALINK-01", () => {
  it("DFA pending-approval and awaiting-dispatch links use /estab/dfa?focus=<id>, never /estab/dfa/<id>", async () => {
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(estabDfa).values({
        id: PENDING_DFA, tenantId: TENANT, dfaNo: "DFA/2026/0931", communicationType: "letter",
        subject: "Awaiting approval", body: "Draft body", status: "pending_approval",
        decisionModality: "approved", createdBy: ACTOR, updatedBy: ACTOR, version: 1,
      });
      await tx.insert(estabDfa).values({
        id: SIGNED_DFA, tenantId: TENANT, dfaNo: "DFA/2026/0932", communicationType: "letter",
        subject: "Ready to dispatch", body: "Draft body", status: "signed",
        decisionModality: "approved", createdBy: ACTOR, updatedBy: ACTOR, version: 1,
      });
    }));

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/estab/notifications?limit=50", headers: authHeader() });
    await app.close();

    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ kind: string; id: string; link: string }>;
    const pending = data.find((n) => n.id === `dfa_pa:${PENDING_DFA}`);
    const dispatch = data.find((n) => n.id === `dfa_disp:${SIGNED_DFA}`);
    expect(pending).toBeDefined();
    expect(dispatch).toBeDefined();

    expect(pending!.link).toBe(`/estab/dfa?focus=${PENDING_DFA}`);
    expect(dispatch!.link).toBe(`/estab/dfa?focus=${SIGNED_DFA}`);
    // The broken shape must be gone.
    expect(pending!.link).not.toBe(`/estab/dfa/${PENDING_DFA}`);
    expect(dispatch!.link).not.toBe(`/estab/dfa/${SIGNED_DFA}`);
    // Query-string targets the reachable list route, not a non-existent [id] page.
    for (const n of [pending!, dispatch!]) {
      expect(n.link.startsWith("/estab/dfa?")).toBe(true);
    }
  });
});
