import { createHmac, randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";

const JWT_SECRET = "test_secret_for_civitasone_32chr";
const TENANT_ID = "00000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000099";
const SESSION_ID = "e2e-session-" + randomUUID().slice(0, 8);

function b64url(obj: object): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function signHS256(payload: object): string {
  const header = b64url({ alg: "HS256", typ: "JWT" });
  const body = b64url(payload);
  const signature = createHmac("sha256", JWT_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

/**
 * Generates a valid HS256 JWT and injects it as the `access_token` cookie
 * for the web app domain. Must be called before navigating to authenticated pages.
 */
export async function injectAuthCookie(page: Page): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const token = signHS256({
    sub: USER_ID,
    tid: TENANT_ID,
    tenantId: TENANT_ID,
    roles: ["super_admin"],
    sid: SESSION_ID,
    iss: "civitasone-e2e",
    iat: now,
    exp: now + 3600,
  });

  await page.context().addCookies([
    {
      name: "access_token",
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ]);
}
