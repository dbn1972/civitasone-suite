/**
 * GAP2-PROJECTS-ESCALATIONS-04: the escalations endpoint must not fabricate
 * escalatedTo ("Program Director"), issue ("Critical blocker reported"/
 * "Timeline exceeded") or an escalationId ("ESC-NNN") sequence. For a project
 * with NO persisted escalation record those fields are null; when a real
 * escalation record exists they come from the DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { signToken } from "@civitasone/auth";

const JWT_SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000e4";
const ACTOR = "11111111-1111-4000-8000-0000000000e4";
const PROJECT_BLOCKED = "33333333-3333-4000-8000-0000000000e4";
const PROJECT_WITH_ESC = "44444444-4444-4000-8000-0000000000e4";

const state = vi.hoisted(() => ({
  projectRows: [] as Record<string, unknown>[],
  persisted: [] as Record<string, unknown>[],
}));

vi.mock("../src/shared/db.js", () => {
  function chain(rows: unknown[]) {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.where = () => c;
    c.orderBy = () => c;
    c.limit = () => rows;
    return c;
  }
  const tx = { select: () => chain(state.projectRows) };
  return {
    db: {
      transaction: async (cb: (t: unknown) => Promise<unknown>) => cb(tx),
    },
  };
});

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: async <T>(_k: string, loader: () => Promise<T>) => loader(),
    makeKey: (...p: string[]) => p.join(":"),
    invalidate: async () => undefined,
  },
}));

vi.mock("../src/modules/escalation/repo.js", () => ({
  listByProjectIdsTx: async () => state.persisted,
}));

let app: FastifyInstance;

beforeEach(async () => {
  state.projectRows = [];
  state.persisted = [];
  if (app) await app.close();
  const { mockEliminationRoutes } = await import("../src/modules/project/mock-elimination-routes.js");
  app = Fastify({ logger: false });
  const { authPlugin } = await import("@civitasone/auth/plugin");
  await app.register(authPlugin);
  await app.register(mockEliminationRoutes);
  await app.ready();
});

function token(): string {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["super_admin"], sid: "sess-1" }, JWT_SECRET, 3600);
}

describe("GAP2-PROJECTS-ESCALATIONS-04 — no fabricated escalation fields", () => {
  it("a delayed/blocked project with NO persisted escalation emits null issue/escalatedTo/escalationId", async () => {
    state.projectRows = [
      { id: PROJECT_BLOCKED, code: "P-1", name: "Drain Phase II", status: "blocked", createdAt: new Date("2026-01-02") },
    ];
    state.persisted = [];
    const res = await app.inject({ method: "GET", url: "/v1/projects/escalations", headers: { authorization: `Bearer ${token()}` } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const raw = JSON.stringify(body);
    // No fabricated literals anywhere in the response.
    expect(raw).not.toContain("Program Director");
    expect(raw).not.toContain("Critical blocker reported");
    expect(raw).not.toContain("Timeline exceeded");
    expect(raw).not.toContain("ESC-");
    const row = body.data[0];
    expect(row.escalatedTo).toBeNull();
    expect(row.issue).toBeNull();
    expect(row.escalationId).toBeNull();
    // Factual projection fields are still present.
    expect(row.projectId).toBe(PROJECT_BLOCKED);
    expect(row.severity).toBe("blocked");
    expect(row.status).toBe("open");
  });

  it("a project WITH a persisted escalation surfaces the real DB values", async () => {
    state.projectRows = [
      { id: PROJECT_WITH_ESC, code: "P-2", name: "Road Widening", status: "delayed", createdAt: new Date("2026-02-03") },
    ];
    state.persisted = [
      {
        id: "esc-real-1", projectId: PROJECT_WITH_ESC, issue: "Land acquisition stalled",
        severity: "overdue", escalatedTo: "Chief Engineer", status: "acknowledged",
      },
    ];
    const res = await app.inject({ method: "GET", url: "/v1/projects/escalations", headers: { authorization: `Bearer ${token()}` } });
    expect(res.statusCode).toBe(200);
    const row = res.json().data[0];
    expect(row.escalationId).toBe("esc-real-1");
    expect(row.issue).toBe("Land acquisition stalled");
    expect(row.escalatedTo).toBe("Chief Engineer");
    expect(row.status).toBe("acknowledged");
  });
});
