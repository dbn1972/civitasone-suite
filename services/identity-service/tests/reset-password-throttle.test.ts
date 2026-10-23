/**
 * GAP-TENANT-ADMIN-USERS-DETAIL-06 (real DB, real Fastify): POST
 * /identity/users/:id/reset-password sends the user an email, so it is throttled
 * per target user. The (MAX+1)th request in the window is a 429 with no command
 * published; another user in the same tenant, and the same user id in another
 * tenant, are unaffected; the 404 for an unknown user does not consume budget.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import type { FastifyInstance } from "fastify";
import { db, sqlClient } from "../src/shared/db.js";
import { users } from "../src/modules/users/schema.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { PASSWORD_RESET_MAX_PER_WINDOW } from "../src/modules/users/routes.js";

const SECRET = process.env.JWT_SECRET as string;
const T = randomUUID();
const ACTOR = randomUUID();
const U1 = randomUUID();
const U2 = randomUUID();
const bearer = () => ({ authorization: `Bearer ${signToken({ sub: ACTOR, roles: ["tenant_admin"], tid: T } as never, SECRET)}` });

async function seed(id: string, email: string) {
  await runWithTenant(T, () => db.transaction((tx) => tx.insert(users).values({
    id, tenantId: T, email, name: "Reset Target", status: "active", createdBy: ACTOR, updatedBy: ACTOR,
  }).onConflictDoNothing()));
}

let app: FastifyInstance;
beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
  await seed(U1, `${U1}@throttle.gov.in`);
  await seed(U2, `${U2}@throttle.gov.in`);
});
afterAll(async () => {
  await runWithTenant(T, () => db.transaction(async (tx) => {
    await tx.delete(users).where(eq(users.id, U1));
    await tx.delete(users).where(eq(users.id, U2));
  }));
  await app.close();
  await sqlClient.end();
});

const reset = (id: string) => app.inject({ method: "POST", url: `/identity/users/${id}/reset-password`, headers: bearer(), payload: { reason: "forgot it" } });

describe("reset-password throttle", () => {
  it("allows MAX requests, then 429s the next one without publishing a command", async () => {
    const spy = vi.spyOn(queue, "publish");
    for (let i = 0; i < PASSWORD_RESET_MAX_PER_WINDOW; i++) expect((await reset(U1)).statusCode).toBe(202);
    const blocked = await reset(U1);
    expect(blocked.statusCode).toBe(429);
    expect((blocked.json() as { code: string }).code).toBe("RESET_RECENTLY_REQUESTED");
    const published = spy.mock.calls.filter((c) => c[0] === COMMANDS.resetCredential);
    expect(published).toHaveLength(PASSWORD_RESET_MAX_PER_WINDOW);
    spy.mockRestore();
  });

  it("another user in the same tenant is not throttled", async () => {
    expect((await reset(U2)).statusCode).toBe(202);
  });

  it("an unknown user is 404 and does not consume the per-user budget", async () => {
    const ghost = randomUUID();
    for (let i = 0; i < PASSWORD_RESET_MAX_PER_WINDOW + 2; i++) expect((await reset(ghost)).statusCode).toBe(404);
  });
});
