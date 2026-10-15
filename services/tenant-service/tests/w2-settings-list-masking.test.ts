/**
 * GAP-TENANT-SETTINGS-01 (W2 tenant part 1): GET /v1/tenant/settings (the path
 * the web loads) must never return a credential-named key's value. Given a
 * smtp_password key and an ordinary key; when an admin lists settings; then the
 * secret value is masked and the ordinary value is intact. A bare employee gets
 * 403 (role gate, pinned in w2-tenant-web-paths-authz.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import * as repo from "../src/modules/settings/repo.js";
import { maskSecretSettings, MASKED_SETTING_VALUE } from "../src/modules/settings/routes.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const ACTOR = randomUUID();
const PLAIN_VALUE = randomUUID();
const SECRET_VALUE = randomUUID();

beforeAll(async () => {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await repo.insert(tx, { tenantId: TENANT, key: "smtp_password", value: SECRET_VALUE, updatedBy: ACTOR, createdBy: ACTOR });
      await repo.insert(tx, { tenantId: TENANT, key: "session_timeout_min", value: PLAIN_VALUE, updatedBy: ACTOR, createdBy: ACTOR });
    }),
  );
});

afterAll(async () => {
  await sqlClient.end();
});

describe("W2 SETTINGS-01: list masks credential-named keys", () => {
  it.each(["/v1/tenant/settings", "/v1/settings"])("%s masks the secret, keeps the ordinary value", async (url) => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url,
      headers: { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["tenant_admin"], sid: "s-w2" }, SECRET, 3600)}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ key: string; value: unknown }>;
    expect(rows.find((r) => r.key === "smtp_password")?.value).toBe(MASKED_SETTING_VALUE);
    expect(rows.find((r) => r.key === "session_timeout_min")?.value).toBe(PLAIN_VALUE);
    expect(JSON.stringify(rows)).not.toContain(SECRET_VALUE);
  });

  it("maskSecretSettings masks token/api_key/private-key names and leaves others", () => {
    const out = maskSecretSettings([
      { key: "auth_token", value: 1 },
      { key: "payment.api_key", value: 2 },
      { key: "signing-private-key", value: 3 },
      { key: "theme", value: 4 },
    ]);
    expect(out.map((r) => r.value)).toEqual([MASKED_SETTING_VALUE, MASKED_SETTING_VALUE, MASKED_SETTING_VALUE, 4]);
  });
});
