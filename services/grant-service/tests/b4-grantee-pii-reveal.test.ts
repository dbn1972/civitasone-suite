/**
 * GAP-GRANTS-LIST-03 (UAT B4): DPDP handling of grantee names on the grants list.
 *  - GET /v1/grants/grants never sends a natural person's name in the clear
 *    (type "individual"); institutions / societies / missions are not natural
 *    persons and stay readable. The row says whether it is masked and its type.
 *  - POST /v1/grants/pii/reveal is the only way to see the clear name: grant maker
 *    roles only, a reason of at least 10 characters, tenant-scoped, and a durable
 *    audit record is written (without the value) before the value is returned.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Queue, Handler } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { runWithTenant, withTenantConsumer } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { grantSchemes } from "../src/modules/scheme/schema.js";
import { grantApplications } from "../src/modules/application/schema.js";
import { grantBeneficiaries } from "../src/modules/beneficiary/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { registerBeneficiaryConsumers } from "../src/modules/beneficiary/consumer.js";
import { maskPersonName } from "../src/modules/beneficiary/domain.js";

const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const SECRET = process.env.JWT_SECRET ?? globalThis.crypto.randomUUID();
const REASON = "Verifying payee identity for sanction file 14/2026";

const scoped = <T>(tenant: string, fn: (tx: typeof db) => Promise<T>) =>
  runWithTenant(tenant, () => db.transaction((tx) => fn(tx as unknown as typeof db)));
const token = (roles: string[], tid = TENANT) => signToken({ sub: ACTOR, tid, roles, sid: "s-b4p" }, SECRET, 3600);

const PERSON = randomUUID();
const SOCIETY = randomUUID();
const FOREIGN_PERSON = randomUUID();

async function call(method: "GET" | "POST", url: string, roles: string[], payload?: unknown, tid = TENANT) {
  const app = await buildApp();
  const res = await app.inject({ method, url, headers: { authorization: `Bearer ${token(roles, tid)}` }, ...(payload ? { payload: payload as object } : {}) });
  await app.close();
  return res;
}
const reveal = (roles: string[], body: Record<string, unknown>, tid = TENANT) => call("POST", "/v1/grants/pii/reveal", roles, body, tid);
const auditRows = async () =>
  (await scoped(TENANT, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT))))
    .filter((r) => r.eventType === "audit.event.record" && JSON.stringify(r.payload).includes("pii_reveal"));

beforeAll(async () => {
  const wired = queue as unknown as Queue;
  const raw = wired.subscribe.bind(wired);
  wired.subscribe = ((topic: string, handler: Handler) => raw(topic, withTenantConsumer(handler) as Handler)) as typeof wired.subscribe;
  registerBeneficiaryConsumers(wired);
  await wired.start();

  const schemeId = randomUUID();
  await scoped(TENANT, async (tx) => {
    await tx.insert(grantSchemes).values({
      id: schemeId, tenantId: TENANT, code: `B4P-${schemeId.slice(0, 8)}`, name: "B4 PII Scheme",
      budgetMinor: 1_000_000n, maxAmountMinor: 1_000_000n, status: "active", createdBy: ACTOR, updatedBy: ACTOR,
    });
    for (const [id, name, type] of [[PERSON, "Savitri Deshmukh", "individual"], [SOCIETY, "Nashik Mahila Mandal", "society"]] as const) {
      await tx.insert(grantBeneficiaries).values({ id, tenantId: TENANT, name, type, createdBy: ACTOR, updatedBy: ACTOR });
      await tx.insert(grantApplications).values({
        tenantId: TENANT, grantNo: `G-B4P-${id.slice(0, 6)}`, schemeId, beneficiaryId: id, purpose: "B4 pii grant",
        amountRequestedMinor: 100_000n, amountApprovedMinor: 100_000n, status: "approved",
        createdBy: ACTOR, updatedBy: ACTOR,
      });
    }
  });
  await scoped(OTHER_TENANT, (tx) => tx.insert(grantBeneficiaries).values({
    id: FOREIGN_PERSON, tenantId: OTHER_TENANT, name: "Other Tenant Person", type: "individual", createdBy: ACTOR, updatedBy: ACTOR,
  }));
});

afterAll(async () => {
  await queue.stop();
  for (const t of [TENANT, OTHER_TENANT]) {
    await scoped(t, async (tx) => {
      await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
      await tx.delete(grantApplications).where(eq(grantApplications.tenantId, t));
      await tx.delete(grantBeneficiaries).where(eq(grantBeneficiaries.tenantId, t));
      await tx.delete(grantSchemes).where(eq(grantSchemes.tenantId, t));
    });
  }
  await sqlClient.end();
});

describe("maskPersonName (pure)", () => {
  it("keeps the first character and hides the rest, never leaking the length of short names", () => {
    expect(maskPersonName("Savitri Deshmukh")).toBe(`S${"•".repeat(15)}`);
    expect(maskPersonName("Li")).toBe("L••");
    expect(maskPersonName("  ")).toBe("");
  });
});

describe("GET /v1/grants/grants masks natural persons server-side", () => {
  it("masks an individual, leaves a society readable, and flags both", async () => {
    const res = await call("GET", "/v1/grants/grants", ["grant_officer"]);
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<Record<string, unknown>>;
    const person = rows.find((r) => r.granteeId === PERSON)!;
    const society = rows.find((r) => r.granteeId === SOCIETY)!;
    expect(person.granteeNameMasked).toBe(true);
    expect(person.granteeType).toBe("individual");
    expect(person.granteeName).not.toContain("Savitri");
    expect(person.granteeName).toBe(maskPersonName("Savitri Deshmukh"));
    expect(society.granteeNameMasked).toBe(false);
    expect(society.granteeName).toBe("Nashik Mahila Mandal");
    expect(JSON.stringify(rows)).not.toContain("Deshmukh");
  });

  it("masks for every reader role, not only the unprivileged ones", async () => {
    for (const roles of [["grant_reviewer"], ["audit_officer"], ["grant_admin"]]) {
      const rows = (await call("GET", "/v1/grants/grants", roles)).json() as Array<Record<string, unknown>>;
      expect(rows.find((r) => r.granteeId === PERSON)!.granteeNameMasked).toBe(true);
    }
  });
});

describe("POST /v1/grants/pii/reveal", () => {
  const body = { resourceType: "grantee", resourceId: PERSON, field: "name", reason: REASON };

  it("403 for roles that may not reveal", async () => {
    for (const roles of [["grant_reviewer"], ["audit_officer"], ["grant_viewer"], ["employee"]]) {
      expect((await reveal(roles, body)).statusCode).toBe(403);
    }
  });

  it("400 without a real reason", async () => {
    expect((await reveal(["grant_officer"], { ...body, reason: "too short" })).statusCode).toBe(400);
    expect((await reveal(["grant_officer"], { ...body, reason: undefined })).statusCode).toBe(400);
  });

  it("422 for a field that is not revealable", async () => {
    expect((await reveal(["grant_officer"], { ...body, field: "incomeAnnualMinor" })).statusCode).toBe(422);
  });

  it("404 for an unknown grantee and for another tenant's grantee", async () => {
    expect((await reveal(["grant_officer"], { ...body, resourceId: randomUUID() })).statusCode).toBe(404);
    expect((await reveal(["grant_officer"], { ...body, resourceId: FOREIGN_PERSON })).statusCode).toBe(404);
  });

  it("returns the clear name uncached and records an audit event without the value", async () => {
    const before = (await auditRows()).length;
    const res = await reveal(["grant_admin"], body);
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json()).toEqual({ data: { resourceType: "grantee", resourceId: PERSON, field: "name", value: "Savitri Deshmukh" } });

    const deadline = Date.now() + 4000;
    let rows = await auditRows();
    while (rows.length <= before && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      rows = await auditRows();
    }
    expect(rows.length).toBe(before + 1);
    const payload = JSON.stringify(rows.at(-1)!.payload);
    expect(payload).toContain(PERSON);
    expect(payload).toContain("name");
    expect(payload).toContain(REASON);
    expect(payload).not.toContain("Savitri");
  });
});
