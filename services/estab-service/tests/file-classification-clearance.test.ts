/**
 * GAP-ESTAB-WORKSPACE-03 — a file may only be created / opened at a
 * classification the acting officer is cleared for. Server-side enforcement
 * (client-side option hiding is not a control), plus the /classifications
 * endpoint the UI uses to offer only the allowed levels.
 *
 * DB-backed route test (buildApp + app.inject, HS256 test JWT, memory queue /
 * cache per vitest.config.ts). The clearance gate is adoption-aware: it only
 * bites once the tenant has enrolled an active operator, so we seed one with a
 * limited clearance to exercise the deny path. Each case uses a FRESH tenant +
 * actor so the in-process memory cache (operator desks / adoption flag, 60s
 * TTL) from one case can never leak clearance into the next.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { estabFileOperator } from "../src/modules/operators/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow

const tenants: string[] = [];

function freshIds() {
  const tenant = randomUUID();
  const actor = randomUUID();
  tenants.push(tenant);
  return { tenant, actor };
}

function token(tenant: string, actor: string, roles = ["estab_officer"]) {
  return signToken({ sub: actor, tid: tenant, roles, sid: "sess-c3" }, SECRET);
}

async function enrolOperator(tenant: string, actor: string, clearanceLevel: number) {
  await runWithTenant(tenant, () =>
    db.transaction((tx) =>
      tx.insert(estabFileOperator).values({
        id: randomUUID(),
        tenantId: tenant,
        employeeId: actor,
        division: "Administration",
        deskRole: "section_officer",
        clearanceLevel,
        canInitiate: true,
        active: true,
        assignedBy: actor,
        createdBy: actor,
        updatedBy: actor,
      }),
    ),
  );
}

afterAll(async () => {
  for (const tenant of tenants) {
    await runWithTenant(tenant, () =>
      db.transaction((tx) => tx.delete(estabFileOperator).where(eq(estabFileOperator.tenantId, tenant))),
    );
  }
  await sqlClient.end();
});

describe("GAP-ESTAB-WORKSPACE-03 — file classification clearance", () => {
  it("rejects creating a top_secret file by an under-cleared officer with 403", async () => {
    const { tenant, actor } = freshIds();
    await enrolOperator(tenant, actor, 2); // confidential only
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/estab/files",
      headers: { authorization: `Bearer ${token(tenant, actor)}`, "x-tenant-id": tenant, "content-type": "application/json" },
      payload: { subject: "Sensitive matter", dept: "Administration", classification: "top_secret" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("allows creating a file at or below the officer's clearance", async () => {
    const { tenant, actor } = freshIds();
    await enrolOperator(tenant, actor, 2); // confidential
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/estab/files",
      headers: { authorization: `Bearer ${token(tenant, actor)}`, "x-tenant-id": tenant, "content-type": "application/json" },
      payload: { subject: "Routine matter", dept: "Administration", classification: "confidential" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("rejects opening a secret file from a receipt by an under-cleared officer with 403", async () => {
    const { tenant, actor } = freshIds();
    await enrolOperator(tenant, actor, 2);
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/estab/inward/${randomUUID()}/open-file`,
      headers: { authorization: `Bearer ${token(tenant, actor)}`, "x-tenant-id": tenant, "content-type": "application/json" },
      payload: { dept: "Administration", classification: "secret" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("exposes the officer's allowed classifications via /classifications", async () => {
    const { tenant, actor } = freshIds();
    await enrolOperator(tenant, actor, 2); // confidential → public + confidential only
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/files/classifications",
      headers: { authorization: `Bearer ${token(tenant, actor)}`, "x-tenant-id": tenant },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.allowed).toContain("public");
    expect(body.allowed).toContain("confidential");
    expect(body.allowed).not.toContain("secret");
    expect(body.allowed).not.toContain("top_secret");
  });
});
