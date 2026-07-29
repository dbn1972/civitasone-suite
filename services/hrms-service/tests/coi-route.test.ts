/**
 * COI-scan routes — interview-panel scan (reads constituted panel + enrichment)
 * and ad-hoc committee scan.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-bbbb-4000-8000-000000000abb";
const USER = "aaaaaaaa-7777-4000-8000-000000000abb";
const IV = "dddddddd-bbbb-4000-8000-00000000dabb";
const M1 = "11111111-bbbb-4000-8000-000000000001";
const M2 = "11111111-bbbb-4000-8000-000000000002";

const H = vi.hoisted(() => ({ listPanelists: vi.fn() }));

vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  db: { transaction: async (cb: (tx: unknown) => Promise<void>) => cb({}), insert: () => ({ values: async () => undefined }) },
}));
vi.mock("../src/modules/recruitment/panel-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  listPanelists: (...a: unknown[]) => H.listPanelists(...a),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const auth = { authorization: `Bearer ${signToken({ sub: USER, tid: TENANT, roles: ["hr_admin"], sid: "s" }, SECRET)}` };
const panelist = (memberId: string, memberName: string, over = {}) => ({ memberId, memberName, coiDeclared: false, coiType: "none", coiNote: null, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  H.listPanelists.mockResolvedValue([]);
});
afterAll(async () => { await sqlClient.end(); });

describe("coi-scan routes", () => {
  it("scans a candidate against the interview panel and flags a shared surname (200)", async () => {
    H.listPanelists.mockResolvedValue([panelist(M1, "Bala Kumar"), panelist(M2, "Xen Rao")]);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/coi-scan`, headers: auth, payload: { candidate: { name: "Asha Kumar" } } });
    expect(r.statusCode).toBe(200);
    expect(r.json().flags.map((f: { type: string }) => f.type)).toEqual(["shared_name_token"]);
    expect(r.json().hasConflict).toBe(true);
    await app.close();
  });

  it("uses panel enrichment (email/phone) to detect a shared contact (200)", async () => {
    H.listPanelists.mockResolvedValue([panelist(M1, "Totally Different")]);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/coi-scan`, headers: auth, payload: {
      candidate: { name: "Asha Verma", email: "asha@x.in" },
      panelEnrichment: [{ memberId: M1, email: "asha@x.in" }],
    } });
    expect(r.statusCode).toBe(200);
    expect(r.json().flags.map((f: { type: string }) => f.type)).toContain("shared_email");
    await app.close();
  });

  it("surfaces a panelist's self-declared conflict (200)", async () => {
    H.listPanelists.mockResolvedValue([panelist(M1, "Some One", { coiDeclared: true, coiNote: "relative" })]);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/coi-scan`, headers: auth, payload: { candidate: { name: "Unrelated Name" } } });
    expect(r.statusCode).toBe(200);
    expect(r.json().flags.map((f: { type: string }) => f.type)).toContain("declared_conflict");
    expect(r.json().highestSeverity).toBe("high");
    await app.close();
  });

  it("refuses to scan an interview with no constituted panel (409)", async () => {
    H.listPanelists.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/coi-scan`, headers: auth, payload: { candidate: { name: "A B" } } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NO_PANEL");
    await app.close();
  });

  it("scans against an ad-hoc committee panel (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/recruitment/coi-scan`, headers: auth, payload: {
      candidate: { name: "Ravi Kumar", phone: "9876543210" },
      panelMembers: [{ memberId: M1, memberName: "Sita Kumar", phone: "98765 43210" }],
    } });
    expect(r.statusCode).toBe(200);
    const types = r.json().flags.map((f: { type: string }) => f.type).sort();
    expect(types).toEqual(["shared_name_token", "shared_phone"]);
    await app.close();
  });
});
