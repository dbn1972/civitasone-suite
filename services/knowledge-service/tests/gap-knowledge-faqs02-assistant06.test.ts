/**
 * GAP-KNOWLEDGE-FAQS-02: browse endpoints must hide non-published FAQs/flows
 *   from non-editor roles (knowledge_user) while editors (knowledge_admin) see all.
 * GAP-KNOWLEDGE-ASSISTANT-06: free-text questions must have PII (Aadhaar/PAN/
 *   phone/email) redacted before persistence (DPDP retention).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow
const TENANT = randomUUID();
const ADMIN = "cccccccc-0000-4000-8000-00000000b001";

function tok(roles: string[], sub = ADMIN) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess" }, SECRET, 3600);
}
const adminTok = tok(["knowledge_admin"]);
const userTok = tok(["knowledge_user"]);

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { await app.close(); await sqlClient.end(); });

function idOf(res: { json: () => unknown }): string {
  const b = res.json() as { id?: string; data?: { id?: string } };
  return (b.data?.id ?? b.id)!;
}

describe("GAP-KNOWLEDGE-FAQS-02 — status visibility", () => {
  it("hides draft FAQs from a non-editor but shows them to an editor", async () => {
    const marker = `faqvis-${randomUUID().slice(0, 8)}`;
    // published FAQ
    const pub = await app.inject({
      method: "POST", url: "/v1/knowledge/faqs",
      headers: { authorization: `Bearer ${adminTok}`, "content-type": "application/json" },
      payload: { question: `${marker} published question`, answer: "answer", category: marker, status: "published" },
    });
    expect(pub.statusCode).toBe(202);
    // draft FAQ
    const draft = await app.inject({
      method: "POST", url: "/v1/knowledge/faqs",
      headers: { authorization: `Bearer ${adminTok}`, "content-type": "application/json" },
      payload: { question: `${marker} draft question`, answer: "answer", category: marker, status: "draft" },
    });
    expect(draft.statusCode).toBe(202);

    // non-editor: only the published FAQ in this category
    const asUser = await app.inject({ method: "GET", url: `/v1/knowledge/faqs?category=${marker}`, headers: { authorization: `Bearer ${userTok}` } });
    expect(asUser.statusCode).toBe(200);
    const userRows = asUser.json() as Array<{ status: string }>;
    expect(userRows.length).toBe(1);
    expect(userRows.every((r) => r.status === "published")).toBe(true);

    // editor: both the published and draft FAQ
    const asAdmin = await app.inject({ method: "GET", url: `/v1/knowledge/faqs?category=${marker}`, headers: { authorization: `Bearer ${adminTok}` } });
    expect(asAdmin.statusCode).toBe(200);
    const adminRows = asAdmin.json() as Array<{ status: string }>;
    expect(adminRows.length).toBe(2);
    expect(adminRows.some((r) => r.status === "draft")).toBe(true);
  });

  it("requires a token (401 without auth)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/knowledge/faqs" });
    expect(res.statusCode).toBe(401);
  });
});

describe("GAP-KNOWLEDGE-ASSISTANT-06 — PII redaction before persistence", () => {
  it("redacts Aadhaar/PAN/phone/email from the stored question", async () => {
    const ask = await app.inject({
      method: "POST", url: "/v1/knowledge/assistant/ask",
      headers: { authorization: `Bearer ${userTok}`, "content-type": "application/json" },
      payload: { question: "my Aadhaar 1234 5678 9012 PAN ABCDE1234F phone 9876543210 email a@b.com" },
    });
    expect(ask.statusCode).toBe(200);
    const interactionId = (ask.json() as { data: { interactionId: string } }).data.interactionId;

    const stored = await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      const rows = await sql`SELECT question FROM knowledge.assistant_interactions WHERE id = ${interactionId} AND tenant_id = ${TENANT}`;
      return (rows as unknown as Array<{ question: string }>)[0]?.question ?? "";
    });

    expect(stored).toContain("[AADHAAR]");
    expect(stored).toContain("[PAN]");
    expect(stored).toContain("[PHONE]");
    expect(stored).toContain("[EMAIL]");
    expect(stored).not.toContain("1234 5678 9012");
    expect(stored).not.toContain("ABCDE1234F");
    expect(stored).not.toContain("9876543210");
    expect(stored).not.toContain("a@b.com");
  });
});
