/**
 * GAP-ESTAB-APPROVAL-MATRIX-03 — the approver-role catalogue.
 *
 * Which role codes may appear in an approval rule's chain is the deployment's configuration
 * (ESTAB_APPROVER_ROLES), not something this service invents. Given a configured list, a rule that
 * names a role outside it is refused (422 UNKNOWN_APPROVER_ROLE) on create and on a chain edit, and
 * the list is served with the rules so the matrix form can offer only those roles. With no list
 * configured nothing changes: any well-formed role is accepted and the form falls back to
 * format-checked entry.
 */
import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";

// The list read is stubbed so these cases need no database; the write path (validate → publish) is real.
vi.mock("../src/modules/approval-rules/queries.js", () => ({
  listApprovalRules: vi.fn(async () => []),
  getApprovalRule: vi.fn(async () => null),
}));

import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { estabApprovalRule } from "../src/modules/approval-rules/schema.js";
import {
  parseApproverRoleCatalogue, unknownApproverRoles, assertApproverRolesKnown,
} from "../src/modules/approval-rules/roleCatalogue.js";

// vitest.config.ts sets JWT_SECRET for every suite.
const SECRET = process.env.JWT_SECRET as string;
const TENANT = "0f1a5e00-4000-4000-8000-0000000007c3";
const ACTOR = "0f1a5e00-5000-4000-8000-0000000007c3";

function authHeader(roles: string[]) {
  const token = signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-am03" }, SECRET, 3600);
  // x-tenant-id as the gateway forwards it, so the PATCH existence read runs under this tenant's RLS GUC.
  return { authorization: `Bearer ${token}`, "x-tenant-id": TENANT };
}

const rule = (roles: string[]) => ({
  module: "finance",
  sourceType: "finance_sanction",
  label: `AM03 ${randomUUID().slice(0, 8)}`,
  minAmountMinor: 0,
  maxAmountMinor: 500_000,
  workflowDefinitionCode: `finance.sanction.${randomUUID().slice(0, 8)}`,
  startNodeKey: "start",
  steps: roles.map((role) => ({ role, label: role })),
  priority: 100,
});

const ORIGINAL = process.env.ESTAB_APPROVER_ROLES;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ESTAB_APPROVER_ROLES;
  else process.env.ESTAB_APPROVER_ROLES = ORIGINAL;
});
afterAll(async () => { await sqlClient.end(); });

describe("parseApproverRoleCatalogue", () => {
  it("is not configured for an unset or empty value", () => {
    expect(parseApproverRoleCatalogue(undefined)).toEqual({ configured: false, roles: [] });
    expect(parseApproverRoleCatalogue("")).toEqual({ configured: false, roles: [] });
    expect(parseApproverRoleCatalogue(" , ,")).toEqual({ configured: false, roles: [] });
  });

  it("keeps valid role codes in order, de-duplicated, trimmed", () => {
    expect(parseApproverRoleCatalogue(" section_officer, under_secretary ,section_officer,deputy_secretary"))
      .toEqual({ configured: true, roles: ["section_officer", "under_secretary", "deputy_secretary"] });
  });

  it("drops entries that are not valid role codes (so a typo in the setting cannot widen the list)", () => {
    expect(parseApproverRoleCatalogue("director,Bad Role,CTO,x,ceo!,cto"))
      .toEqual({ configured: true, roles: ["director", "cto"] });
  });

  it("a value with only invalid entries is 'not configured', never an empty allow-list that blocks everything", () => {
    expect(parseApproverRoleCatalogue("Bad Role,!!")).toEqual({ configured: false, roles: [] });
  });
});

describe("unknownApproverRoles / assertApproverRolesKnown", () => {
  const catalogue = { configured: true, roles: ["director", "cto"] };

  it("lists each unknown role once", () => {
    expect(unknownApproverRoles([{ role: "director" }, { role: "ghost" }, { role: "ghost" }, { role: "phantom" }], catalogue))
      .toEqual(["ghost", "phantom"]);
  });

  it("finds nothing unknown when every role is listed, or when no list is configured", () => {
    expect(unknownApproverRoles([{ role: "cto" }], catalogue)).toEqual([]);
    expect(unknownApproverRoles([{ role: "anything" }], { configured: false, roles: [] })).toEqual([]);
  });

  it("assert throws a 422 UNKNOWN_APPROVER_ROLE when a configured list lacks a role, and is silent without steps", () => {
    process.env.ESTAB_APPROVER_ROLES = "director";
    expect(() => assertApproverRolesKnown([{ role: "ghost" }])).toThrowError(/unknown approver role: ghost/);
    try {
      assertApproverRolesKnown([{ role: "ghost" }]);
    } catch (err) {
      expect(err).toMatchObject({ status: 422, code: "UNKNOWN_APPROVER_ROLE" });
    }
    expect(() => assertApproverRolesKnown(undefined)).not.toThrow();
    expect(() => assertApproverRolesKnown([{ role: "director" }])).not.toThrow();
  });
});

describe("approval-rules routes with the catalogue (GAP-ESTAB-APPROVAL-MATRIX-03)", () => {
  beforeEach(() => {
    delete process.env.ESTAB_APPROVER_ROLES;
  });

  it("serves the configured list with the rules, for an officer who can read the matrix", async () => {
    process.env.ESTAB_APPROVER_ROLES = "section_officer,under_secretary";
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/estab/approval-rules", headers: authHeader(["estab_officer"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: [],
      approverRoles: { configured: true, roles: ["section_officer", "under_secretary"] },
    });
  });

  it("says 'not configured' when the deployment declared no list", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/estab/approval-rules", headers: authHeader(["estab_admin"]) });
    await app.close();
    expect(res.json().approverRoles).toEqual({ configured: false, roles: [] });
  });

  it("does not serve the list to a role that cannot read the matrix", async () => {
    process.env.ESTAB_APPROVER_ROLES = "section_officer";
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/estab/approval-rules", headers: authHeader(["citizen"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain("section_officer");
  });

  it("POST: refuses a chain naming an unknown role with 422 UNKNOWN_APPROVER_ROLE", async () => {
    process.env.ESTAB_APPROVER_ROLES = "section_officer,under_secretary";
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/estab/approval-rules", headers: authHeader(["estab_admin"]),
      payload: rule(["section_officer", "ghost_role"]),
    });
    await app.close();
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("UNKNOWN_APPROVER_ROLE");
    expect(res.json().message).toContain("ghost_role");
  });

  it("POST: accepts a chain of listed roles (202)", async () => {
    process.env.ESTAB_APPROVER_ROLES = "section_officer,under_secretary";
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/estab/approval-rules", headers: authHeader(["estab_admin"]),
      payload: rule(["under_secretary", "section_officer"]),
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("POST: with no list configured nothing changes — any role is accepted", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/estab/approval-rules", headers: authHeader(["estab_admin"]),
      payload: rule(["whatever_role"]),
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("PATCH: refuses an edited chain with an unknown role, but a patch with no chain (activate / deactivate) is unaffected", async () => {
    process.env.ESTAB_APPROVER_ROLES = "section_officer";
    const app = await buildApp();
    // UAT W8-A: PATCH now 404s an unknown rule before publishing, so the chain checks below act on a real rule.
    const id = randomUUID();
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(estabApprovalRule).values({
      id, tenantId: TENANT, module: "finance", sourceType: "finance_sanction", label: `AM03 seed ${id.slice(0, 8)}`,
      workflowDefinitionCode: `finance.sanction.${id.slice(0, 8)}`, createdBy: ACTOR, updatedBy: ACTOR,
    })));
    const bad = await app.inject({
      method: "PATCH", url: `/v1/estab/approval-rules/${id}`, headers: authHeader(["estab_admin"]),
      payload: { steps: [{ role: "ghost_role", label: "Ghost" }] },
    });
    const toggle = await app.inject({
      method: "PATCH", url: `/v1/estab/approval-rules/${id}`, headers: authHeader(["estab_admin"]),
      payload: { active: false },
    });
    const good = await app.inject({
      method: "PATCH", url: `/v1/estab/approval-rules/${id}`, headers: authHeader(["estab_admin"]),
      payload: { steps: [{ role: "section_officer", label: "Section Officer" }] },
    });
    await app.close();
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.delete(estabApprovalRule).where(eq(estabApprovalRule.id, id))));
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code).toBe("UNKNOWN_APPROVER_ROLE");
    expect(toggle.statusCode).toBe(202);
    expect(good.statusCode).toBe(202);
  });

  it("still refuses a plain clerk first (403), before looking at the roles", async () => {
    process.env.ESTAB_APPROVER_ROLES = "section_officer";
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/estab/approval-rules", headers: authHeader(["estab_officer"]),
      payload: rule(["ghost_role"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
