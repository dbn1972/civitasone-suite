/**
 * D14 / D12 / B2 (owner-approved) — file classification tiers, the Confidential+ view gate,
 * DAK default + reclassify-with-reason, and the default approver catalogue.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { estabInward, estabFiles } from "../src/modules/files/schema.js";
import {
  FILE_CLASSIFICATIONS, roleMayAccessClassification, isConfidentialOrAbove,
} from "../src/modules/files/domain.js";
import { createFileBody, registerInwardBody, reclassifyInwardBody, openFileFromInwardBody } from "../src/modules/files/validators.js";
import { CLASSIFICATION_RANK } from "../src/modules/operators/eligibility.js";
import { getApproverRoleCatalogue, DEFAULT_APPROVER_ROLES } from "../src/modules/approval-rules/roleCatalogue.js";

const SECRET = process.env.JWT_SECRET as string;
const tenants: string[] = [];

function ids() {
  const tenant = randomUUID();
  tenants.push(tenant);
  return { tenant, actor: randomUUID() };
}
function headers(tenant: string, actor: string, roles: string[]) {
  const token = signToken({ sub: actor, tid: tenant, roles, sid: "sess-d14" }, SECRET, 3600);
  return { authorization: `Bearer ${token}`, "x-tenant-id": tenant, "content-type": "application/json" };
}

afterAll(async () => {
  for (const tenant of tenants) {
    await runWithTenant(tenant, () => db.transaction(async (tx) => {
      await tx.delete(estabInward).where(eq(estabInward.tenantId, tenant));
      await tx.delete(estabFiles).where(eq(estabFiles.tenantId, tenant));
    }));
  }
  await sqlClient.end();
});

describe("classification vocabulary (D14)", () => {
  it("has the four owner tiers (Ordinary stored as public) plus legacy top_secret", () => {
    for (const c of ["public", "restricted", "confidential", "secret", "top_secret"]) {
      expect(FILE_CLASSIFICATIONS).toContain(c);
    }
    expect(CLASSIFICATION_RANK.restricted).toBe(CLASSIFICATION_RANK.public);
  });

  it("defaults to Ordinary (public) at file create, DAK register and nothing is forced on open-file", () => {
    expect(createFileBody.parse({ subject: "s", dept: "d" }).classification).toBe("public");
    expect(registerInwardBody.parse({ fromAddress: "a", subject: "s" }).classification).toBe("public");
    expect(openFileFromInwardBody.parse({ dept: "d" }).classification).toBeUndefined();
  });

  it("rejects an unknown tier and a reclassify without a reason", () => {
    expect(() => createFileBody.parse({ subject: "s", dept: "d", classification: "vip" })).toThrow();
    expect(() => reclassifyInwardBody.parse({ classification: "restricted", reason: " " })).toThrow();
    expect(reclassifyInwardBody.parse({ classification: "restricted", reason: "contains PII" }).classification).toBe("restricted");
  });

  it("role gate: Confidential and above need knowledge_admin / estab_admin; below is open", () => {
    expect(isConfidentialOrAbove("restricted")).toBe(false);
    expect(roleMayAccessClassification(["estab_officer"], "public")).toBe(true);
    expect(roleMayAccessClassification(["estab_officer"], "restricted")).toBe(true);
    for (const c of ["confidential", "secret", "top_secret"]) {
      expect(roleMayAccessClassification(["estab_officer"], c)).toBe(false);
      expect(roleMayAccessClassification(["estab_deputy_secretary"], c)).toBe(false);
      expect(roleMayAccessClassification(["knowledge_admin"], c)).toBe(true);
      expect(roleMayAccessClassification(["estab_admin"], c)).toBe(true);
    }
  });
});

describe("B2 default approver catalogue", () => {
  it("serves estab_admin, estab_deputy_secretary, estab_division_admin when the env is unset", () => {
    const prev = process.env.ESTAB_APPROVER_ROLES;
    delete process.env.ESTAB_APPROVER_ROLES;
    try {
      expect(getApproverRoleCatalogue()).toEqual({ configured: true, roles: [...DEFAULT_APPROVER_ROLES] });
      expect(DEFAULT_APPROVER_ROLES).toEqual(["estab_admin", "estab_deputy_secretary", "estab_division_admin"]);
      process.env.ESTAB_APPROVER_ROLES = "director";
      expect(getApproverRoleCatalogue().roles).toEqual(["director"]);
    } finally {
      if (prev === undefined) delete process.env.ESTAB_APPROVER_ROLES; else process.env.ESTAB_APPROVER_ROLES = prev;
    }
  });
});

describe("Confidential+ gate on the routes", () => {
  it("refuses an estab_officer creating a Confidential file; allows Restricted/default; allows estab_admin", async () => {
    const { tenant, actor } = ids();
    const app = await buildApp();
    const post = (roles: string[], classification?: string) => app.inject({
      method: "POST", url: "/v1/estab/files", headers: headers(tenant, actor, roles),
      payload: { subject: "Matter", dept: "Administration", ...(classification ? { classification } : {}) },
    });
    expect((await post(["estab_officer"], "confidential")).statusCode).toBe(403);
    expect((await post(["estab_officer"], "restricted")).statusCode).toBe(202);
    expect((await post(["estab_officer"])).statusCode).toBe(202);
    expect((await post(["estab_admin"], "confidential")).statusCode).toBe(202);
    await app.close();
  });

  it("hides a Confidential file from an estab_officer (detail 403) and shows it to estab_admin", async () => {
    const { tenant, actor } = ids();
    const fileId = randomUUID();
    await runWithTenant(tenant, () => db.transaction((tx) => tx.insert(estabFiles).values({
      id: fileId, tenantId: tenant, fileNo: `D14/${fileId.slice(0, 6)}`, subject: "Classified", dept: "Admin",
      classification: "confidential", currentWith: actor, createdBy: actor, updatedBy: actor,
    })));
    const app = await buildApp();
    const get = (roles: string[]) => app.inject({ method: "GET", url: `/v1/estab/files/${fileId}`, headers: headers(tenant, actor, roles) });
    expect((await get(["estab_officer"])).statusCode).toBe(403);
    expect((await get(["estab_admin"])).statusCode).toBe(200);
    await app.close();
  });
});

describe("DAK reclassify (D12)", () => {
  async function seedDak(tenant: string, assignedTo: string | null) {
    const id = randomUUID();
    await runWithTenant(tenant, () => db.transaction((tx) => tx.insert(estabInward).values({
      id, tenantId: tenant, dakNo: `DAK/D14/${id.slice(0, 6)}`, fromAddress: "x", subject: "y",
      assignedTo, createdBy: randomUUID(), updatedBy: randomUUID(),
    })));
    return id;
  }

  it("only the dealing hand may reclassify; reason mandatory; Confidential+ needs the role gate", async () => {
    const { tenant, actor } = ids();
    const other = randomUUID();
    const mine = await seedDak(tenant, actor);
    const unassigned = await seedDak(tenant, null);
    const app = await buildApp();
    const call = (id: string, who: string, roles: string[], payload: object) => app.inject({
      method: "POST", url: `/v1/estab/inward/${id}/reclassify`, headers: headers(tenant, who, roles), payload,
    });
    const ok = { classification: "restricted", reason: "contains personal data" };
    expect((await call(mine, actor, ["estab_officer"], { classification: "restricted" })).statusCode).toBe(400);
    expect((await call(mine, other, ["estab_officer"], ok)).statusCode).toBe(403);
    expect((await call(unassigned, actor, ["estab_officer"], ok)).statusCode).toBe(409);
    expect((await call(randomUUID(), actor, ["estab_officer"], ok)).statusCode).toBe(404);
    expect((await call(mine, actor, ["estab_officer"], { classification: "confidential", reason: "sensitive" })).statusCode).toBe(403);
    expect((await call(mine, actor, ["estab_officer"], ok)).statusCode).toBe(202);
    expect((await call(mine, actor, ["estab_admin"], { classification: "confidential", reason: "sensitive" })).statusCode).toBe(202);
    await app.close();
  });
});
