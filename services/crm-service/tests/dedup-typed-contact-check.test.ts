/**
 * GAP-CRM-GRIEVANCES-NEW-01 - the backend contract the grievance form's "this phone / email already belongs
 * to a contact" warning relies on. POST /v1/crm/contacts/duplicate-check is asked with ONLY a typed phone
 * and/or email; it must (a) recognise the same subscriber however the number or address is written,
 * (b) answer with ids, matched field NAMES and a score - never a phone or an email - and (c) stay behind the
 * CRM role gate and the caller's own tenant.
 *
 * Pure scoring is tested directly; the route is tested with the dedup repo stubbed so the row contents are
 * under the test's control (email and phone are encrypted at rest, so a real round trip needs the PII key).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterAll, beforeEach, vi } from "vitest";
import { signToken } from "@civitasone/auth";

vi.mock("../src/modules/contacts/dedup-repo.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/modules/contacts/dedup-repo.js")>()),
  getRules: vi.fn(),
  fetchCandidates: vi.fn(),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import * as dedupRepo from "../src/modules/contacts/dedup-repo.js";
import { DEFAULT_DEDUP_RULES, rankDuplicates, type DedupRule } from "../src/modules/contacts/dedup-domain.js";

const rules = DEFAULT_DEDUP_RULES as readonly DedupRule[];
const STORED = [
  { id: "c-phone", phone: "9876543210", email: "someone.else@example.gov.in", name: "Meera Devi" },
  { id: "c-email", phone: "9000000001", email: "Asha.Rao@Example.gov.in", name: "Asha Rao" },
  { id: "c-none", phone: "9111111111", email: "nobody@example.gov.in", name: "No Match" },
];

describe("a typed phone / email is matched however it is written", () => {
  it.each(["9876543210", "+919876543210", "+91-9876543210", "98765 43210", "09876543210", " 9876543210 "])(
    "phone %j finds the stored number",
    (typed) => {
      const hits = rankDuplicates({ phone: typed }, STORED, rules);
      expect(hits.map((h) => h.id)).toEqual(["c-phone"]);
      expect(hits[0]!.matchedFields).toEqual(["phone"]);
    },
  );

  it.each(["asha.rao@example.gov.in", "ASHA.RAO@EXAMPLE.GOV.IN", "  Asha.Rao@Example.gov.in "])("email %j finds the stored address", (typed) => {
    const hits = rankDuplicates({ email: typed }, STORED, rules);
    expect(hits.map((h) => h.id)).toEqual(["c-email"]);
    expect(hits[0]!.matchedFields).toEqual(["email"]);
  });

  it("a value nobody has finds nobody, and nothing is guessed from the name", () => {
    expect(rankDuplicates({ phone: "9222222222" }, STORED, rules)).toEqual([]);
    expect(rankDuplicates({ email: "stranger@example.gov.in" }, STORED, rules)).toEqual([]);
    expect(rankDuplicates({}, STORED, rules)).toEqual([]);
  });

  it("a match carries exactly { id, matchedFields, score } - no value of the contact", () => {
    for (const hit of [...rankDuplicates({ phone: "9876543210" }, STORED, rules), ...rankDuplicates({ email: "asha.rao@example.gov.in" }, STORED, rules)]) {
      expect(Object.keys(hit).sort()).toEqual(["id", "matchedFields", "score"]);
    }
  });

  it("honours the tenant's rules: a tenant that switched the phone rule off gets no phone match", () => {
    const noPhone = rules.map((r) => (r.field === "phone" ? { ...r, enabled: false } : r));
    expect(rankDuplicates({ phone: "9876543210" }, STORED, noPhone)).toEqual([]);
    expect(rankDuplicates({ email: "asha.rao@example.gov.in" }, STORED, noPhone).map((h) => h.id)).toEqual(["c-email"]);
  });
});

// ── the route ────────────────────────────────────────────────────────────────

const SECRET = process.env.JWT_SECRET as string; // set by vitest.config.ts
const TENANT = randomUUID();
const ACTOR = randomUUID();

function headers(roles: string[]) {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
    "x-tenant-id": TENANT,
  };
}

const app = await buildApp();

beforeEach(() => {
  vi.mocked(dedupRepo.getRules).mockReset().mockResolvedValue([...rules]);
  vi.mocked(dedupRepo.fetchCandidates).mockReset().mockResolvedValue(STORED as never);
});
afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

function check(body: unknown, roles = ["crm_user"]) {
  return app.inject({ method: "POST", url: "/v1/crm/contacts/duplicate-check", headers: headers(roles), payload: body as object });
}

describe("POST /v1/crm/contacts/duplicate-check with only a typed phone / email", () => {
  it("answers { data: [{ id, matchedFields, score }] } and repeats no phone, email or name", async () => {
    const res = await check({ phone: "+91-9876543210" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [{ id: "c-phone", matchedFields: ["phone"], score: 30 }] });
    for (const leaked of ["9876543210", "someone.else@example.gov.in", "Meera Devi", "Asha"]) expect(res.body).not.toContain(leaked);

    const byEmail = await check({ email: "ASHA.RAO@example.gov.in" });
    expect(byEmail.json()).toEqual({ data: [{ id: "c-email", matchedFields: ["email"], score: 40 }] });
    for (const leaked of ["Asha.Rao@Example.gov.in", "9000000001", "Asha Rao"]) expect(byEmail.body).not.toContain(leaked);
  });

  it("is tenant-scoped: the rules and the candidates are read for the CALLER's tenant only", async () => {
    await check({ phone: "9876543210" });
    expect(dedupRepo.getRules).toHaveBeenCalledWith(TENANT, ACTOR);
    expect(vi.mocked(dedupRepo.fetchCandidates).mock.calls[0]![0]).toBe(TENANT);
  });

  it.each([["crm_user"], ["crm_admin"], ["super_admin"]])("is open to the CRM role %s", async (role) => {
    expect((await check({ phone: "9876543210" }, [role])).statusCode).toBe(200);
  });

  it.each([["citizen"], ["auditor"]])("is refused (403) to %s before any contact is read", async (role) => {
    const res = await check({ phone: "9876543210" }, [role]);
    expect(res.statusCode).toBe(403);
    expect(dedupRepo.fetchCandidates).not.toHaveBeenCalled();
  });
});
