/**
 * D14 / D12 / B2 (owner-approved) — file classification tiers, the Confidential+ view gate,
 * DAK default + reclassify-with-reason, and the default approver catalogue.
 */
import { describe, it, expect, afterAll, vi } from "vitest";

// The dealing-hand id-space bridge (identity sub -> HRMS employee id) is stubbed; everything else is real.
const EMPLOYEE_OF = new Map<string, string>();
vi.mock("../src/shared/hrms-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/shared/hrms-client.js")>()),
  resolveActorEmployeeId: vi.fn(async (_t: string, actor: string) => EMPLOYEE_OF.get(actor) ?? null),
}));
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { estabInward, estabFiles, estabNotings, estabFileMovements } from "../src/modules/files/schema.js";
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
      await tx.delete(estabNotings).where(eq(estabNotings.tenantId, tenant));
      await tx.delete(estabFileMovements).where(eq(estabFileMovements.tenantId, tenant));
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


describe("D14 gate on EVERY route returning or mutating classified content", () => {
  async function seed(tenant: string, actor: string, classification: string) {
    const fileId = randomUUID();
    const inwardId = randomUUID();
    await runWithTenant(tenant, () => db.transaction(async (tx) => {
      await tx.insert(estabFiles).values({
        id: fileId, tenantId: tenant, fileNo: `D14/${fileId.slice(0, 6)}`, subject: "SECRET-SUBJECT-LINE", dept: "Admin",
        classification, currentWith: actor, createdBy: actor, updatedBy: actor, status: "active",
      });
      await tx.insert(estabNotings).values({
        tenantId: tenant, fileId, seq: 1, officerId: actor, body: "SECRET-NOTE-BODY", createdBy: actor, updatedBy: actor,
      });
      await tx.insert(estabFileMovements).values({
        tenantId: tenant, fileId, toOfficerId: actor, remarks: "SECRET-MOVE-REMARK",
      });
      await tx.insert(estabInward).values({
        id: inwardId, tenantId: tenant, dakNo: `DAK/D14/${inwardId.slice(0, 6)}`, fromAddress: "x", subject: "SECRET-DAK-SUBJECT",
        classification, fileId, createdBy: actor, updatedBy: actor,
      });
    }));
    return { fileId, inwardId };
  }

  it("a plain estab_officer is refused or filtered on every read route for a Confidential file", async () => {
    const { tenant, actor } = ids();
    const { fileId, inwardId } = await seed(tenant, actor, "confidential");
    const app = await buildApp();
    const get = (url: string, roles: string[]) => app.inject({ method: "GET", url, headers: headers(tenant, actor, roles) });

    for (const url of [
      `/v1/estab/files/${fileId}`,
      `/v1/estab/files/${fileId}/movements`,
      `/v1/estab/files/${fileId}/note-sheet/pdf`,
      `/v1/estab/files/${fileId}/scanned-documents`,
      `/v1/estab/files/${fileId}/decision-log`,
      `/v1/estab/inward/${inwardId}/movements`,
    ]) {
      const officer = await get(url, ["estab_officer"]);
      expect(officer.statusCode, url).toBe(403);
      expect(officer.body, url).not.toContain("SECRET-");
    }
    for (const url of [
      "/v1/estab/notings", "/v1/estab/files", "/v1/estab/files/mine", "/v1/estab/inward", "/v1/estab/dak",
      "/v1/estab/files/search?q=SECRET", "/v1/estab/files/duplicate-check?subject=SECRET-SUBJECT-LINE",
    ]) {
      const officer = await get(url, ["estab_officer"]);
      expect(officer.statusCode, url).toBe(200);
      expect(officer.body, url).not.toContain("SECRET-");
      expect(officer.body, url).not.toContain(fileId);
    }
    // ...and the same data is visible to a classified-access role (the filters do not just hide everything).
    expect((await get("/v1/estab/notings", ["estab_admin"])).body).toContain("SECRET-NOTE-BODY");
    expect((await get("/v1/estab/inward", ["estab_admin"])).body).toContain("SECRET-DAK-SUBJECT");
    expect((await get(`/v1/estab/files/${fileId}/movements`, ["knowledge_admin", "estab_officer"])).statusCode).toBe(200);
    await app.close();
  });

  it("an Ordinary file stays fully visible to a plain estab_officer", async () => {
    const { tenant, actor } = ids();
    const { fileId } = await seed(tenant, actor, "public");
    const app = await buildApp();
    const get = (url: string) => app.inject({ method: "GET", url, headers: headers(tenant, actor, ["estab_officer"]) });
    expect((await get("/v1/estab/notings")).body).toContain("SECRET-NOTE-BODY");
    expect((await get(`/v1/estab/files/${fileId}/movements`)).statusCode).toBe(200);
    expect((await get("/v1/estab/inward")).body).toContain("SECRET-DAK-SUBJECT");
    await app.close();
  });

  it("a plain estab_officer cannot mutate a Confidential file by id", async () => {
    const { tenant, actor } = ids();
    const { fileId, inwardId } = await seed(tenant, actor, "confidential");
    const other = await seed(tenant, actor, "public");
    const app = await buildApp();
    const base = `/v1/estab/files/${fileId}`;
    const attempts: Array<["POST" | "PATCH", string, object]> = [
      ["POST", `${base}/notings`, { body: "x" }],
      ["POST", `${base}/volumes`, {}],
      ["POST", `${base}/parts`, {}],
      ["POST", `${base}/links`, { targetFileId: other.fileId, linkType: "related" }],
      ["PATCH", `${base}/type`, { fileType: "regular" }],
      ["POST", `${base}/submit-for-approval`, { notingId: randomUUID() }],
      ["PATCH", `${base}/move`, { toOfficer: randomUUID() }],
      ["PATCH", `${base}/close`, { remarks: "done" }],
      ["PATCH", `${base}/recall`, {}],
      ["PATCH", `${base}/reopen`, { reason: "because" }],
      ["POST", `${base}/attachments`, { fileName: "a.pdf" }],
      ["POST", `${base}/attach-receipt`, { inwardId: other.inwardId }],
      ["POST", `/v1/estab/files/${other.fileId}/attach-receipt`, { inwardId }],
      ["POST", `/v1/estab/files/${other.fileId}/links`, { targetFileId: fileId, linkType: "related" }],
    ];
    for (const [method, url, payload] of attempts) {
      const res = await app.inject({ method, url, headers: headers(tenant, actor, ["estab_officer"]), payload });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
    await app.close();
  });

  it("refuses marking a Confidential+ file to another holder (their roles cannot be verified); self is fine", async () => {
    const { tenant, actor } = ids();
    const { fileId } = await seed(tenant, actor, "confidential");
    const app = await buildApp();
    const move = (toOfficer: string) => app.inject({
      method: "PATCH", url: `/v1/estab/files/${fileId}/move`, headers: headers(tenant, actor, ["estab_admin"]), payload: { toOfficer },
    });
    const refused = await move(randomUUID());
    expect(refused.statusCode).toBe(422);
    expect(refused.json().code).toBe("CLASSIFIED_HOLDER_UNVERIFIED");
    expect((await move(actor)).statusCode).toBe(202);
    const create = await app.inject({
      method: "POST", url: "/v1/estab/files", headers: headers(tenant, actor, ["estab_admin"]),
      payload: { subject: "Matter", dept: "Admin", classification: "secret", currentWith: randomUUID() },
    });
    expect(create.json().code).toBe("CLASSIFIED_HOLDER_UNVERIFIED");
    await app.close();
  });

  it("linkage from-module: an explicit Confidential+ needs the role (default is now Ordinary)", async () => {
    const { tenant, actor } = ids();
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/estab/files/from-module", headers: headers(tenant, actor, ["estab_officer"]),
      payload: {
        refType: "finance_sanction", refId: randomUUID(), subject: "Sanction", dept: "Fin", classification: "confidential",
        currentWith: randomUUID(), approvalChain: "x", initialNote: "n",
      },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe("DAK reclassify id-space and downgrade gate (D12)", () => {
  async function dak(tenant: string, assignedTo: string, classification = "public") {
    const id = randomUUID();
    await runWithTenant(tenant, () => db.transaction((tx) => tx.insert(estabInward).values({
      id, tenantId: tenant, dakNo: `DAK/D14/${id.slice(0, 6)}`, fromAddress: "x", subject: "y",
      assignedTo, classification, createdBy: randomUUID(), updatedBy: randomUUID(),
    })));
    return id;
  }

  it("matches the dealing hand when assignedTo is the caller's HRMS employee id (not their identity sub)", async () => {
    const { tenant, actor } = ids();
    const employee = randomUUID();
    EMPLOYEE_OF.set(actor, employee);
    const viaEmployee = await dak(tenant, employee);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: `/v1/estab/inward/${viaEmployee}/reclassify`, headers: headers(tenant, actor, ["estab_officer"]),
      payload: { classification: "restricted", reason: "personal data" },
    });
    expect(res.statusCode).toBe(202);
    const stranger = await dak(tenant, randomUUID());
    const denied = await app.inject({
      method: "POST", url: `/v1/estab/inward/${stranger}/reclassify`, headers: headers(tenant, actor, ["estab_officer"]),
      payload: { classification: "restricted", reason: "personal data" },
    });
    expect(denied.statusCode).toBe(403);
    await app.close();
  });

  it("downgrading a Confidential+ DAK needs a classified-access role even for the dealing hand", async () => {
    const { tenant, actor } = ids();
    const id = await dak(tenant, actor, "confidential");
    const app = await buildApp();
    const call = (roles: string[]) => app.inject({
      method: "POST", url: `/v1/estab/inward/${id}/reclassify`, headers: headers(tenant, actor, roles),
      payload: { classification: "public", reason: "released to public" },
    });
    expect((await call(["estab_officer"])).statusCode).toBe(403);
    expect((await call(["estab_admin"])).statusCode).toBe(202);
    await app.close();
  });
});
