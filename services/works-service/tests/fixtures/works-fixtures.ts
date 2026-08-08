/**
 * Deterministic, tenant-scoped synthetic fixtures for works-service tests.
 * All IDs are fixed UUIDs — safe for replay/idempotency assertions.
 */

export const TENANT_A = "11111111-bbbb-4000-8000-000000000001";
export const TENANT_B = "22222222-bbbb-4000-8000-000000000002";
export const ACTOR_A = "00000000-aaaa-4000-8000-000000000001";
export const ACTOR_B = "00000000-aaaa-4000-8000-000000000002";

export const WORK_ID = "00000000-1111-4000-8000-000000000001";
export const WORK_ID_B = "00000000-1111-4000-8000-000000000099";
export const AWARD_ID = "00000000-2222-4000-8000-000000000001";
export const MB_ID = "00000000-3333-4000-8000-000000000001";
export const BOQ_ITEM_ID = "00000000-4444-4000-8000-000000000001";
export const AA_ID = "00000000-5555-4000-8000-000000000001";
export const TS_ID = "00000000-6666-4000-8000-000000000001";
export const BILL_ID = "00000000-7777-4000-8000-000000000001";

export function queueMessage(tenantId: string, actorId: string, messageId: string) {
  return {
    messageId,
    tenantId,
    actorId,
    correlationId: `corr-${messageId}`,
    schemaVersion: "1.0" as const,
  };
}

export function jwtPayload(tenantId: string, roles: string[], actorId = ACTOR_A) {
  return {
    sub: actorId,
    tid: tenantId,
    roles,
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

export function bearerToken(payload: ReturnType<typeof jwtPayload>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.${Buffer.from("test-sig").toString("base64url")}`;
}
