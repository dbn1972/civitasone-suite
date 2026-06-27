// Mints an HS256 dev token identical in shape to the /auth/dev login, for
// verifying the UAT auth path end-to-end. Prints only the token.
const { createHmac } = require("node:crypto");
const SECRET = process.env.JWT_SECRET || "civitasone-dev-secret";
const TENANT = process.env.DEMO_TENANT_ID || "00000000-0000-0000-0000-000000000001";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const header = b64({ alg: "HS256", typ: "JWT" });
const payload = b64({
  sub: "00000000-0000-0000-0000-000000000099",
  iss: "civitasone-dev",
  tid: TENANT, tenantId: TENANT, sid: "dev-session",
  email: "superadmin@civitasone.dev", name: "Super Admin",
  roles: ["super_admin", "admin", "tenant_admin", "finance_admin", "hr_admin"],
  iat: now, exp: now + 3600,
});
const sig = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
process.stdout.write(`${header}.${payload}.${sig}`);
