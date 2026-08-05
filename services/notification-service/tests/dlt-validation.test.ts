/**
 * G8 — DLT (TRAI) Template Validation Tests
 *
 * Tests:
 * 1. Pure domain function: pattern matching (exact, with variables, mismatch)
 * 2. Route tests: CRUD on DLT templates, auth checks
 * 3. Integration: 422 on unregistered template in send path
 */
import { describe, it, expect, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { validateDltTemplate } from "../src/modules/dlt/validate.js";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { randomUUID } from "node:crypto";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000001";
const ACTOR = "cccccccc-3333-4000-8000-000000000001";

function adminToken(tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles: ["tenant_admin"], sid: "sess-dlt" }, SECRET);
}

function userToken(tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles: ["notification_user"], sid: "sess-dlt" }, SECRET);
}

afterAll(async () => { await sqlClient.end(); });

// ---------- Pure domain: validateDltTemplate ----------

describe("validateDltTemplate — pattern matching", () => {
  it("matches exact text (no variables)", () => {
    const pattern = "Your OTP is 1234. Do not share.";
    const body = "Your OTP is 1234. Do not share.";
    expect(validateDltTemplate(body, pattern)).toBe(true);
  });

  it("matches pattern with single variable", () => {
    const pattern = "Your OTP is {#var#}. Do not share.";
    expect(validateDltTemplate("Your OTP is 5678. Do not share.", pattern)).toBe(true);
    expect(validateDltTemplate("Your OTP is ABCDEF. Do not share.", pattern)).toBe(true);
  });

  it("matches pattern with multiple variables", () => {
    const pattern = "Dear {#var#}, your appointment is on {#var#} at {#var#}.";
    const body = "Dear John, your appointment is on 15-Jan-2025 at 10:30 AM.";
    expect(validateDltTemplate(body, pattern)).toBe(true);
  });

  it("rejects message that does not match pattern", () => {
    const pattern = "Your OTP is {#var#}. Do not share.";
    const body = "This is a completely different message.";
    expect(validateDltTemplate(body, pattern)).toBe(false);
  });

  it("rejects message with extra text", () => {
    const pattern = "Your OTP is {#var#}.";
    const body = "Your OTP is 1234. Extra text here.";
    expect(validateDltTemplate(body, pattern)).toBe(false);
  });

  it("rejects message with missing text", () => {
    const pattern = "Your OTP is {#var#}. Do not share.";
    const body = "Your OTP is 1234.";
    expect(validateDltTemplate(body, pattern)).toBe(false);
  });

  it("handles special regex characters in template", () => {
    const pattern = "Amount: Rs.{#var#} debited from A/C {#var#}. (Ref: {#var#})";
    const body = "Amount: Rs.500.00 debited from A/C 1234567890. (Ref: TXN001)";
    expect(validateDltTemplate(body, pattern)).toBe(true);
  });

  it("variable must be non-empty (at least one char)", () => {
    const pattern = "Hello {#var#}, welcome!";
    const body = "Hello , welcome!";
    expect(validateDltTemplate(body, pattern)).toBe(false);
  });
});

// ---------- Route tests: CRUD on DLT templates ----------

describe("DLT template routes", () => {
  it("POST /notifications/dlt-templates — creates a DLT template (admin)", async () => {
    const app = await buildApp();
    const uniqueTemplateId = `110716${Date.now().toString().slice(-7)}`;
    const res = await app.inject({
      method: "POST",
      url: "/notifications/dlt-templates",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        entityId: "1001234567890",
        templateId: uniqueTemplateId,
        headerId: "MYAPP",
        contentType: "transactional",
        templateBody: "Your OTP is {#var#}. Valid for {#var#} minutes.",
        channel: "sms",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json.data.templateId).toBe(uniqueTemplateId);
    expect(json.data.channel).toBe("sms");
    expect(json.data.status).toBe("active");
  });

  it("POST /notifications/dlt-templates — 403 for non-admin", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/dlt-templates",
      headers: { authorization: `Bearer ${userToken()}` },
      payload: {
        entityId: "1001234567890",
        templateId: `110716${Date.now().toString().slice(-7)}`,
        headerId: "MYAPP",
        contentType: "transactional",
        templateBody: "Hello {#var#}",
        channel: "sms",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("POST /notifications/dlt-templates — 401 without token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/dlt-templates",
      payload: {
        entityId: "1001234567890",
        templateId: `110716${Date.now().toString().slice(-7)}`,
        headerId: "MYAPP",
        contentType: "transactional",
        templateBody: "Hello {#var#}",
        channel: "sms",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("GET /notifications/dlt-templates — lists templates", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/dlt-templates",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeInstanceOf(Array);
  });

  it("GET /notifications/dlt-templates/:id — 404 for missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/notifications/dlt-templates/00000000-0000-4000-8000-000000000099",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("PATCH /notifications/dlt-templates/:id — 404 for missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/notifications/dlt-templates/00000000-0000-4000-8000-000000000099",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { status: "expired" },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("DELETE /notifications/dlt-templates/:id — 404 for missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/notifications/dlt-templates/00000000-0000-4000-8000-000000000099",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("DELETE /notifications/dlt-templates/:id — 403 for non-admin", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/notifications/dlt-templates/00000000-0000-4000-8000-000000000099",
      headers: { authorization: `Bearer ${userToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ---------- Integration: DLT guard in send path ----------

describe("DLT guard — requiresDlt", () => {
  it("requires DLT for sms channel", async () => {
    const { requiresDlt } = await import("../src/modules/dlt/guard.js");
    expect(requiresDlt("sms")).toBe(true);
    expect(requiresDlt("whatsapp")).toBe(true);
    expect(requiresDlt("email")).toBe(false);
    expect(requiresDlt("push")).toBe(false);
  });
});

// ---------- validateDltCompliance — integration function ----------

describe("validateDltCompliance — domain integration", () => {
  it("returns valid:true for non-regulated channels (email/push)", async () => {
    const { validateDltCompliance } = await import("../src/modules/dlt/validator.js");
    const result = await validateDltCompliance(TENANT, "email", "Any body text");
    expect(result.valid).toBe(true);
    expect(result.reason).toBe("channel_not_regulated");
  });

  it("returns valid:false when no templates are registered", async () => {
    const { validateDltCompliance } = await import("../src/modules/dlt/validator.js");
    // Non-existent tenant → no templates → rejected
    const result = await validateDltCompliance("00000000-0000-4000-8000-999999999999", "sms", "Hello world");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("no_dlt_templates_registered");
  });

  it("returns valid:false when body does not match any template", async () => {
    const { validateDltCompliance } = await import("../src/modules/dlt/validator.js");
    // Register a template first, then test with non-matching body
    const app = await buildApp();
    const uniqueId = `COMPL${Date.now().toString().slice(-7)}`;
    await app.inject({
      method: "POST",
      url: "/notifications/dlt-templates",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        entityId: "1001234567890",
        templateId: uniqueId,
        headerId: "MYAPP",
        contentType: "transactional",
        templateBody: "Your OTP is {#var#}. Valid for 10 minutes.",
        channel: "sms",
      },
    });
    await app.close();

    const result = await validateDltCompliance(TENANT, "sms", "This doesn't match anything");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("no_matching_dlt_template");
  });

  it("returns valid:true with matched dltTemplateId when body matches", async () => {
    const { validateDltCompliance } = await import("../src/modules/dlt/validator.js");
    const app = await buildApp();
    const uniqueId = `MATCH${Date.now().toString().slice(-7)}`;
    await app.inject({
      method: "POST",
      url: "/notifications/dlt-templates",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        entityId: "1001234567890",
        templateId: uniqueId,
        headerId: "MYAPP",
        contentType: "transactional",
        templateBody: "Hello {#var#}, your order {#var#} has shipped.",
        channel: "sms",
      },
    });
    await app.close();

    const result = await validateDltCompliance(TENANT, "sms", "Hello John, your order ORD123 has shipped.");
    expect(result.valid).toBe(true);
    expect(result.dltTemplateId).toBeDefined();
  });
});

// ---------- DLT guard — expired template rejected ----------

describe("DLT guard — expired template handling", () => {
  it("checkDlt rejects when only expired templates exist", async () => {
    const { checkDlt } = await import("../src/modules/dlt/guard.js");
    const app = await buildApp();
    const uniqueId = `EXP${Date.now().toString().slice(-8)}`;
    // Register with already-expired date
    const res = await app.inject({
      method: "POST",
      url: "/notifications/dlt-templates",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        entityId: "1001234567890",
        templateId: uniqueId,
        headerId: "MYAPP",
        contentType: "transactional",
        templateBody: "Expired template {#var#} test",
        channel: "whatsapp",
        status: "expired",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(201);

    // checkDlt only finds 'active' templates, so expired ones won't match
    const result = await checkDlt(TENANT, "whatsapp", "Expired template XYZ test");
    expect(result.passed).toBe(false);
  });
});

// ---------- DLT template PATCH to revoked status ----------

describe("DLT template status management", () => {
  it("can update template status to revoked", async () => {
    const app = await buildApp();
    const uniqueId = `REV${Date.now().toString().slice(-8)}`;
    const createRes = await app.inject({
      method: "POST",
      url: "/notifications/dlt-templates",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        entityId: "1001234567890",
        templateId: uniqueId,
        headerId: "MYAPP",
        contentType: "promotional",
        templateBody: "Sale! {#var#}% off today.",
        channel: "sms",
      },
    });
    expect(createRes.statusCode).toBe(201);
    const templateUuid = createRes.json().data.id;

    const patchRes = await app.inject({
      method: "PATCH",
      url: `/notifications/dlt-templates/${templateUuid}`,
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { status: "revoked" },
    });
    await app.close();
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().data.status).toBe("revoked");
  });

  it("POST /notifications/dlt-templates — 400 for invalid body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/notifications/dlt-templates",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        entityId: "",
        templateId: "",
        headerId: "",
        contentType: "invalid_type",
        templateBody: "",
        channel: "telegram",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});
