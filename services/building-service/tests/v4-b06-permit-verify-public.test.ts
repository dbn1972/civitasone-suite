/**
 * V4-B-06: GET /v1/building/permits/verify is the public QR-verification endpoint. It used to 401
 * every anonymous caller (not config.public) and, behind that, read the FORCE-RLS building_permits
 * table with no tenant context (0 rows for every code). It now reads the non-RLS
 * building_permit_directory, kept in sync by the permits repo in the same transaction.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import * as repo from "../src/modules/permits/repo.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();
let app: FastifyInstance;

beforeAll(async () => { app = await buildApp(); await app.ready(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

async function issue(over: Partial<Parameters<typeof repo.insertPermit>[1]> = {}) {
  const code = `V4B06${randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const id = randomUUID();
  await runWithTenant(TENANT, () => db.transaction((tx) => repo.insertPermit(tx, {
    id, tenantId: TENANT, applicationId: randomUUID(), permitNumber: `BP-${code}`, status: "active",
    issuedAt: new Date("2026-01-01T00:00:00Z"), validUntil: new Date("2027-01-01T00:00:00Z"),
    verificationCode: code, createdBy: ACTOR, updatedBy: ACTOR, ...over,
  })));
  return { id, code };
}
const verify = (code: string) => app.inject({ method: "GET", url: `/v1/building/permits/verify?code=${code}` });

describe("GET /v1/building/permits/verify (public)", () => {
  it("resolves an issued permit for an anonymous caller, exposing only public fields", async () => {
    const { code } = await issue();
    const res = await verify(code);
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Record<string, unknown>;
    expect(data["status"]).toBe("active");
    expect(Object.keys(data).sort()).toEqual(["issuedAt", "permitNumber", "status", "validUntil"]);
  });

  it("404s an unknown code (not 401)", async () => {
    expect((await verify("nope-nope-nope")).statusCode).toBe(404);
  });

  it("reflects suspension and renewal validity (directory stays in sync)", async () => {
    const { id, code } = await issue();
    await runWithTenant(TENANT, () => db.transaction((tx) => repo.updatePermitStatus(tx, id, TENANT, "suspended", { suspendedAt: new Date(), suspensionReason: "x" }, ACTOR)));
    expect((await verify(code)).json().data.status).toBe("suspended");
    const next = new Date("2028-06-01T00:00:00Z");
    await runWithTenant(TENANT, () => db.transaction((tx) => repo.updateValidUntil(tx, id, TENANT, next, ACTOR)));
    expect(new Date((await verify(code)).json().data.validUntil).toISOString()).toBe(next.toISOString());
  });

  it("does not let one tenant's status write touch another tenant's directory row", async () => {
    const { code } = await issue();
    const other = randomUUID();
    await runWithTenant(other, () => db.transaction((tx) => repo.updatePermitStatus(tx, randomUUID(), other, "cancelled", {}, ACTOR)));
    expect((await verify(code)).json().data.status).toBe("active");
  });
});
