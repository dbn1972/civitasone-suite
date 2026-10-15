/**
 * Wave 2 estab part 2 (COMPLIANCE-04, DFA-04, MIGRATION-04, LIST-01, FILES-DETAIL-04).
 *
 * Real estab Postgres (estab_svc, FORCE RLS) through the real routes (buildApp + inject).
 * hrms is faked only at its HTTP boundary: a tenant-aware stand-in for
 * /v1/hrms/internal/employee-summaries (the SF-17b batched lookup).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";

const PORT = 53941;
vi.hoisted(() => {
  process.env.HRMS_SERVICE_URL = "http://127.0.0.1:53941";
  process.env.INTERNAL_SERVICE_SECRET = globalThis.crypto.randomUUID();
});

import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { estabCompliance } from "../src/modules/committee/schema.js";
import { estabDfa } from "../src/modules/dfa/schema.js";
import { estabMigrationRegister } from "../src/modules/migration/schema.js";
import { estabFiles } from "../src/modules/files/schema.js";
import { estabFileOperator } from "../src/modules/operators/schema.js";

const JWT_KEY = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID(); // identity-provider subject of the acting user
const EMP_NAMED = randomUUID();
const EMP_UNKNOWN = randomUUID();
const EMP_FOREIGN = randomUUID();

type Emp = { id: string; fullName: string; departmentName: string; userRef: string | null };
const hrms: Record<string, Emp[]> = {
  [TENANT]: [
    { id: EMP_NAMED, fullName: "Asha Rao", departmentName: "Estate", userRef: null },
    { id: randomUUID(), fullName: "Drafter Dev", departmentName: "Estate", userRef: ACTOR },
  ],
  [OTHER]: [{ id: EMP_FOREIGN, fullName: "Foreign Person", departmentName: "Other", userRef: null }],
};
let server: Server;
const bearer = (tenant: string, actor: string, roles = ["estab_admin"]) =>
  ({ authorization: `Bearer ${signToken({ sub: actor, tid: tenant, roles, sid: "sess-w2" }, JWT_KEY)}`, "x-tenant-id": tenant });

function startFakeHrms(): Promise<void> {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const tenant = String(req.headers["x-tenant-id"] ?? "");
    if (req.headers["x-internal"] !== "1" || req.headers["x-service-secret"] !== process.env.INTERNAL_SERVICE_SECRET) {
      res.statusCode = 401; res.end("{}"); return;
    }
    let rows = [...(hrms[tenant] ?? [])];
    const ids = url.searchParams.get("ids");
    const actorIds = url.searchParams.get("actorIds");
    if (ids) { const s = new Set(ids.split(",")); rows = rows.filter((r) => s.has(r.id)); }
    if (actorIds) { const s = new Set(actorIds.split(",")); rows = rows.filter((r) => r.userRef && s.has(r.userRef)); }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(rows));
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
}

const tx = <T,>(tenant: string, fn: (t: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) =>
  runWithTenant(tenant, () => db.transaction((t) => fn(t)));

const FILE_PUBLIC = randomUUID();
const FILE_CONF = randomUUID();
const FILE_SECRET = randomUUID();
const FILE_OTHER_TENANT = randomUUID();
const NO_FILE = (p: string) => `W2P2-${p}-${TENANT.slice(0, 6)}`;

beforeAll(async () => {
  await startFakeHrms();
  const base = { createdBy: ACTOR, updatedBy: ACTOR };
  await tx(TENANT, async (t) => {
    await t.insert(estabCompliance).values([
      { tenantId: TENANT, complianceCode: "C-1", title: "Named item", category: "RTI", dueDate: "2099-01-01", assignedTo: EMP_NAMED, ...base },
      { tenantId: TENANT, complianceCode: "C-2", title: "Unknown item", category: "RTI", dueDate: "2099-01-01", assignedTo: EMP_UNKNOWN, ...base },
      { tenantId: TENANT, complianceCode: "C-3", title: "Unassigned item", category: "RTI", dueDate: "2099-01-01", ...base },
    ]);
    await t.insert(estabDfa).values({ tenantId: TENANT, dfaNo: "DFA-W2P2-1", subject: "Subj", body: "x".repeat(900), ...base });
    await t.insert(estabFiles).values([
      { id: FILE_PUBLIC, tenantId: TENANT, fileNo: NO_FILE("PUB"), subject: "zebrawave public file", dept: "Admin", classification: "public", currentWith: ACTOR, status: "active", ...base },
      { id: FILE_CONF, tenantId: TENANT, fileNo: NO_FILE("CONF"), subject: "zebrawave confidential file", dept: "Admin", classification: "confidential", currentWith: ACTOR, status: "active", ...base },
      { id: FILE_SECRET, tenantId: TENANT, fileNo: NO_FILE("SEC"), subject: "zebrawave secret file", dept: "Admin", classification: "secret", currentWith: ACTOR, status: "active", ...base },
    ]);
    await t.insert(estabMigrationRegister).values([
      { tenantId: TENANT, legacyFileNo: "L-1", subject: "Linked legacy", dept: "Admin", efileId: FILE_PUBLIC, ...base },
      { tenantId: TENANT, legacyFileNo: "L-2", subject: "Unlinked legacy", dept: "Admin", ...base },
      // points at a file owned by ANOTHER tenant: the number must never leak across tenants
      { tenantId: TENANT, legacyFileNo: "L-3", subject: "Foreign link", dept: "Admin", efileId: FILE_OTHER_TENANT, ...base },
    ]);
  });
  await tx(OTHER, async (t) => {
    await t.insert(estabFiles).values({ id: FILE_OTHER_TENANT, tenantId: OTHER, fileNo: "FOREIGN-FILE-NO", subject: "foreign", dept: "X", currentWith: ACTOR, ...base });
  });
}, 60_000);

afterAll(async () => {
  for (const tenant of [TENANT, OTHER]) {
    await tx(tenant, async (t) => {
      await t.delete(estabMigrationRegister).where(eq(estabMigrationRegister.tenantId, tenant));
      await t.delete(estabCompliance).where(eq(estabCompliance.tenantId, tenant));
      await t.delete(estabDfa).where(eq(estabDfa.tenantId, tenant));
      await t.delete(estabFileOperator).where(eq(estabFileOperator.tenantId, tenant));
      await t.delete(estabFiles).where(eq(estabFiles.tenantId, tenant));
    });
  }
  await new Promise<void>((r) => server.close(() => r()));
  await sqlClient.end();
});

async function get(url: string, tenant = TENANT, actor = ACTOR, roles?: string[]) {
  const app = await buildApp();
  try {
    return await app.inject({ method: "GET", url, headers: bearer(tenant, actor, roles) });
  } finally {
    await app.close();
  }
}

describe("GAP-ESTAB-COMPLIANCE-04: compliance assignee is a name, never an id", () => {
  it("Given items assigned to a known / unknown employee and nobody, When listed, Then only the known one carries a name", async () => {
    const res = await get("/v1/estab/compliance");
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ title: string; assignedTo?: string; assignedToName?: string }>;
    expect(rows.find((r) => r.title === "Named item")?.assignedToName).toBe("Asha Rao");
    expect(rows.find((r) => r.title === "Unknown item")?.assignedToName).toBeUndefined();
    expect(rows.find((r) => r.title === "Unassigned item")?.assignedTo).toBeUndefined();
  });
});

describe("GAP-ESTAB-DFA-04: drafter name and full body", () => {
  it("Given a DFA drafted by a linked login, When listed and fetched, Then createdByName is the employee name and the whole body is returned", async () => {
    const list = await get("/v1/estab/dfa");
    expect(list.statusCode).toBe(200);
    const row = (list.json() as { data: Array<{ id: string; createdByName: string | null; body: string }> }).data[0]!;
    expect(row.createdByName).toBe("Drafter Dev");
    expect(row.body).toHaveLength(900);
    const one = await get(`/v1/estab/dfa/${row.id}`);
    expect((one.json() as { data: { createdByName: string | null } }).data.createdByName).toBe("Drafter Dev");
  });

  it("Given a drafter hrms cannot name, Then createdByName is null (never an id)", async () => {
    const stranger = randomUUID();
    await tx(TENANT, (t) => t.insert(estabDfa).values({ tenantId: TENANT, dfaNo: "DFA-W2P2-2", subject: "S2", body: "b", createdBy: stranger, updatedBy: stranger }));
    const list = await get("/v1/estab/dfa");
    const row = (list.json() as { data: Array<{ dfaNo: string; createdByName: string | null }> }).data.find((d) => d.dfaNo === "DFA-W2P2-2")!;
    expect(row.createdByName).toBeNull();
  });
});

describe("GAP-ESTAB-MIGRATION-04: register shows the eFile number", () => {
  it("Given a row linked to a file, Then efileNo is that file's number; unlinked and cross-tenant links are null", async () => {
    const res = await get("/v1/estab/migration");
    expect(res.statusCode).toBe(200);
    const rows = (res.json() as { data: Array<{ legacyFileNo: string; efileNo: string | null }> }).data;
    expect(rows.find((r) => r.legacyFileNo === "L-1")?.efileNo).toBe(NO_FILE("PUB"));
    expect(rows.find((r) => r.legacyFileNo === "L-2")?.efileNo).toBeNull();
    expect(rows.find((r) => r.legacyFileNo === "L-3")?.efileNo).toBeNull();
    expect(JSON.stringify(rows)).not.toContain("FOREIGN-FILE-NO");
  });
});

describe("GAP-ESTAB-LIST-01: the register and search never carry files above the viewer's clearance", () => {
  const enrol = (employeeId: string, clearanceLevel: number) =>
    tx(TENANT, (t) => t.insert(estabFileOperator).values({
      tenantId: TENANT, employeeId, division: "Admin", deskRole: "section_officer", clearanceLevel, canInitiate: true, active: true,
      assignedBy: ACTOR, createdBy: ACTOR, updatedBy: ACTOR,
    }));
  const subjects = (res: { json: () => unknown }) => ((res.json() as { data: Array<{ subject: string }> }).data).map((f) => f.subject);

  it("Given a tenant that has not adopted operators, Then every file is listed (greenfield behaviour unchanged)", async () => {
    const res = await get("/v1/estab/files");
    expect(subjects(res).filter((s) => s.startsWith("zebrawave"))).toHaveLength(3);
  });

  it("Given a confidential-cleared officer, Then the secret file's subject is absent from list AND search; confidential stays", async () => {
    await enrol(ACTOR, 2);
    // the adoption flag is cached 60s per tenant; bust it as the enrol consumer does
    const { invalidateOperatorCache } = await import("../src/modules/operators/eligibility.js");
    await invalidateOperatorCache(TENANT, ACTOR);
    const list = await get("/v1/estab/files");
    const got = subjects(list).filter((s) => s.startsWith("zebrawave"));
    expect(got).toContain("zebrawave public file");
    expect(got).toContain("zebrawave confidential file");
    expect(got).not.toContain("zebrawave secret file");
    expect(list.body).not.toContain("zebrawave secret file");
    const search = await get("/v1/estab/files/search?q=zebrawave");
    expect(subjects(search)).not.toContain("zebrawave secret file");
    expect(subjects(search)).toContain("zebrawave confidential file");
  });

  it("Given a secret-cleared officer, Then the secret file is listed", async () => {
    const senior = randomUUID();
    await enrol(senior, 3);
    const res = await get("/v1/estab/files", TENANT, senior);
    expect(subjects(res)).toContain("zebrawave secret file");
  });

  it("Given an actor who is not an operator once the tenant has adopted them, Then only public files are listed", async () => {
    const res = await get("/v1/estab/files", TENANT, randomUUID());
    const got = subjects(res).filter((s) => s.startsWith("zebrawave"));
    expect(got).toEqual(["zebrawave public file"]);
  });
});

describe("GAP-ESTAB-FILES-DETAIL-04: batched officer-name resolve", () => {
  const url = (ids: string[]) => `/v1/estab/officers/resolve?ids=${ids.join(",")}`;

  it("Given ids on screen, Then ONE call returns only {id, displayName, departmentName} for those in the caller's tenant", async () => {
    const res = await get(url([EMP_NAMED, EMP_UNKNOWN, EMP_FOREIGN, ACTOR]));
    expect(res.statusCode).toBe(200);
    const data = (res.json() as { data: Array<Record<string, string>> }).data;
    expect(data).toEqual(expect.arrayContaining([
      { id: EMP_NAMED, displayName: "Asha Rao", departmentName: "Estate" },
      { id: ACTOR, displayName: "Drafter Dev", departmentName: "Estate" },
    ]));
    expect(data.find((d) => d.id === EMP_UNKNOWN)).toBeUndefined();
    expect(data.find((d) => d.id === EMP_FOREIGN)).toBeUndefined(); // other tenant
    expect(Object.keys(data[0]!).sort()).toEqual(["departmentName", "displayName", "id"]);
  });

  it("rejects a non-uuid id, an empty list and more than 100 ids", async () => {
    expect((await get(url(["not-a-uuid"]))).statusCode).toBe(400);
    expect((await get("/v1/estab/officers/resolve")).statusCode).toBe(400);
    expect((await get(url(Array.from({ length: 101 }, () => randomUUID())))).statusCode).toBe(400);
  });

  it("is role-gated (a non-estab role gets 403)", async () => {
    expect((await get(url([EMP_NAMED]), TENANT, ACTOR, ["finance_officer"])).statusCode).toBe(403);
  });
});

describe("GAP-ESTAB-DFA-04: a DFA can be linked to a file, and shows the file number", () => {
  const post = async (fileId: string | null, actor = ACTOR) => {
    const app = await buildApp();
    try {
      return await app.inject({
        method: "POST", url: "/v1/estab/dfa",
        headers: { ...bearer(TENANT, actor), "content-type": "application/json" },
        payload: { subject: "Linked draft", body: "body", fileId },
      });
    } finally { await app.close(); }
  };

  it("Given a DFA linked to a file, When listed and fetched, Then fileNo is that file number", async () => {
    await tx(TENANT, (t) => t.insert(estabDfa).values({ tenantId: TENANT, dfaNo: "DFA-W2P2-LINK", subject: "Linked", body: "b", fileId: FILE_PUBLIC, createdBy: ACTOR, updatedBy: ACTOR }));
    const list = await get("/v1/estab/dfa");
    const row = (list.json() as { data: Array<{ id: string; dfaNo: string; fileNo: string | null }> }).data.find((d) => d.dfaNo === "DFA-W2P2-LINK")!;
    expect(row.fileNo).toBe(NO_FILE("PUB"));
    const one = await get(`/v1/estab/dfa/${row.id}`);
    expect((one.json() as { data: { fileNo: string | null } }).data.fileNo).toBe(NO_FILE("PUB"));
    const unlinked = (list.json() as { data: Array<{ dfaNo: string; fileNo: string | null }> }).data.find((d) => d.dfaNo === "DFA-W2P2-2")!;
    expect(unlinked.fileNo).toBeNull();
  });

  it("accepts a link to a file the drafter may see (202), unlinked too", async () => {
    expect((await post(FILE_PUBLIC)).statusCode).toBe(202);
    expect((await post(null)).statusCode).toBe(202);
  });

  it("rejects a link to a file that does not exist or belongs to another tenant (422)", async () => {
    expect((await post(randomUUID())).statusCode).toBe(422);
    expect((await post(FILE_OTHER_TENANT)).statusCode).toBe(422);
  });

  it("rejects a link to a file above the drafter's clearance (403)", async () => {
    // ACTOR was enrolled at confidential (2) by the LIST-01 cases above; the secret file is out of reach.
    expect((await post(FILE_SECRET)).statusCode).toBe(403);
    expect((await post(FILE_CONF)).statusCode).toBe(202);
  });
});
