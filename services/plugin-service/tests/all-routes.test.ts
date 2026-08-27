/**
 * plugin-service — comprehensive route inject tests.
 *
 * Covers all routes across items, registry, hooks, and store modules.
 * Auth boundary (401/403), validation (400), not-found (404), and happy paths.
 *
 * Mocks: repo, commands, and queries modules to isolate route logic from DB.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

/* ─── Mock repo/commands/queries before importing app ─── */

const FAKE_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const TENANT = "11111111-aaaa-4000-8000-000000000055";
const ACTOR = "00000000-aaaa-4000-8000-000000000055";
const PLUGIN_ID = "bbbbbbbb-0000-4000-8000-000000000002";

const fakeItem = {
  id: FAKE_ID,
  tenantId: TENANT,
  name: "test-plugin-item",
  semver: "1.0.0",
  description: "A test item",
  status: "active",
  version: 1,
};

const fakePlugin = {
  id: FAKE_ID,
  tenantId: TENANT,
  manifestJson: { name: "my-plugin", version: "1.0.0" },
  state: "installed",
  installedAt: new Date().toISOString(),
  enabledAt: null,
  disabledAt: null,
  config: null,
  version: 1,
};

const fakeHook = {
  id: FAKE_ID,
  tenantId: TENANT,
  pluginId: PLUGIN_ID,
  eventType: "item.created",
  handlerPath: "/hooks/on-item-created",
  active: true,
  version: 1,
};

const fakeStoreEntry = {
  key: "settings",
  value: { theme: "dark" },
  sizeBytes: 18,
  updatedAt: new Date(),
};

/* ─── Mock items queries & commands ─── */
vi.mock("../src/modules/items/queries.js", () => ({
  getItem: vi.fn(async (id: string, tenantId: string) => {
    if (id === FAKE_ID && tenantId === TENANT) return fakeItem;
    return null;
  }),
  listItems: vi.fn(async () => ({
    data: [fakeItem],
    pagination: { hasMore: false, pageSize: 20 },
  })),
}));

vi.mock("../src/modules/items/commands.js", () => ({
  createItem: vi.fn(async (ctx: unknown) => ({
    id: FAKE_ID,
    status: "accepted",
    correlationId: "corr-1",
  })),
}));

/* ─── Mock registry repo & commands ─── */
vi.mock("../src/modules/registry/repo.js", () => ({
  findById: vi.fn(async (id: string, tenantId: string) => {
    if (id === FAKE_ID && tenantId === TENANT) return fakePlugin;
    return null;
  }),
  // The real registry/repo.ts::listByTenant returns a bare array (there is no
  // separate queries.js wrapping layer for this module, unlike items/ above) —
  // registry/routes.ts itself wraps it into {data, pagination} before handing
  // it to sendValidated. This mock previously returned the already-wrapped
  // shape, which masked a real bug: routes.ts used to pass the bare array
  // straight through, so every real (unmocked) call 400'd with "Expected
  // object, received array". Matching the repo's actual return shape here
  // means this test now exercises the same wrapping routes.ts really does.
  listByTenant: vi.fn(async () => [fakePlugin]),
}));

vi.mock("../src/modules/registry/commands.js", () => ({
  pluginInstall: vi.fn(async (ctx: unknown) => ({
    id: FAKE_ID, status: "accepted", correlationId: "corr-2",
  })),
  pluginEnable: vi.fn(async (ctx: unknown, id: string) => ({
    id, status: "accepted", correlationId: "corr-3",
  })),
  pluginDisable: vi.fn(async (ctx: unknown, id: string) => ({
    id, status: "accepted", correlationId: "corr-4",
  })),
  pluginUninstall: vi.fn(async (ctx: unknown, id: string) => ({
    id, status: "accepted", correlationId: "corr-5",
  })),
  pluginConfigure: vi.fn(async (ctx: unknown, id: string) => ({
    id, status: "accepted", correlationId: "corr-6",
  })),
}));

/* ─── Mock hooks repo & commands ─── */
vi.mock("../src/modules/hooks/repo.js", () => ({
  findById: vi.fn(async (id: string, tenantId: string) => {
    if (id === FAKE_ID && tenantId === TENANT) return fakeHook;
    return null;
  }),
  // See the identical note on registry/repo.js's mock above: hooks/repo.ts's
  // real listByTenant returns a bare array, and hooks/routes.ts wraps it into
  // {data, pagination} itself. This mock previously pre-wrapped the value,
  // which hid the real routes.ts bug (bare array passed straight through,
  // 400'ing every real request) behind a mock that didn't match reality.
  listByTenant: vi.fn(async () => [fakeHook]),
}));

vi.mock("../src/modules/hooks/commands.js", () => ({
  hookRegister: vi.fn(async (ctx: unknown) => ({
    id: FAKE_ID, status: "accepted", correlationId: "corr-7",
  })),
  hookDeregister: vi.fn(async (ctx: unknown, id: string) => ({
    id, status: "accepted", correlationId: "corr-8",
  })),
}));

/* ─── Mock store repo ─── */
vi.mock("../src/modules/store/repo.js", () => ({
  getEntry: vi.fn(async (tenantId: string, pluginId: string, key: string) => {
    if (tenantId === TENANT && pluginId === PLUGIN_ID && key === "settings")
      return fakeStoreEntry;
    return null;
  }),
  getTotalUsageBytes: vi.fn(async () => 1024),
  upsertEntry: vi.fn(async () => undefined),
  deleteEntry: vi.fn(async (tenantId: string, pluginId: string, key: string) => {
    if (tenantId === TENANT && pluginId === PLUGIN_ID && key === "settings")
      return true;
    return false;
  }),
}));

/* ─── Mock items repo (used transitively by queries) ─── */
vi.mock("../src/modules/items/repo.js", () => ({
  findById: vi.fn(async () => null),
  listByTenant: vi.fn(async () => []),
}));

/* ─── Auth helpers ─── */
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

function token(roles: string[] = ["super_admin"], tid = TENANT, sub = ACTOR): string {
  return signToken({ sub, tid, roles, sid: "sess-1" } as never, SECRET);
}
function headers(roles?: string[], tid?: string, sub?: string) {
  return { authorization: `Bearer ${token(roles, tid, sub)}` };
}

let app: FastifyInstance;

beforeAll(async () => {
  const { buildApp } = await import("../src/app.js");
  app = await buildApp();
});
afterAll(async () => { await app.close(); });

// ══════════════════════════════════════════════════════════════════════════════
// ITEMS ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Items routes — auth boundary", () => {
  it("POST /v1/plugins/items → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/plugins/items", payload: { name: "x", semver: "1.0.0" } });
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/plugins/items → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/plugins/items",
      headers: headers(["employee"]),
      payload: { name: "x", semver: "1.0.0" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/plugins/items → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/plugins/items" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/plugins/items → 403 wrong role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/plugins/items", headers: headers(["employee"]) });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/plugins/items/:id → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/plugins/items/${FAKE_ID}` });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/plugins/items/:id → 403 wrong role", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/plugins/items/${FAKE_ID}`, headers: headers(["employee"]) });
    expect(res.statusCode).toBe(403);
  });
});

describe("Items routes — validation (400)", () => {
  it("POST /v1/plugins/items with empty name → 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/plugins/items",
      headers: headers(["plugin_admin"]),
      payload: { name: "", semver: "1.0.0" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("POST /v1/plugins/items with missing semver → 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/plugins/items",
      headers: headers(["plugin_admin"]),
      payload: { name: "valid-name" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/plugins/items/:id with non-uuid → 400", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/plugins/items/not-a-uuid",
      headers: headers(["plugin_admin"]),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });
});

describe("Items routes — not found (404)", () => {
  it("GET /v1/plugins/items/:id for unknown → 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/plugins/items/99999999-9999-4000-8000-999999999999",
      headers: headers(["plugin_admin"]),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });
});

describe("Items routes — happy paths", () => {
  it("POST /v1/plugins/items → 202 accepted", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/plugins/items",
      headers: headers(["plugin_admin"]),
      payload: { name: "my-item", semver: "2.0.0", description: "desc" },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
  });

  it("GET /v1/plugins/items → 200 with paginated data", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/plugins/items",
      headers: headers(["plugin_user"]),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("GET /v1/plugins/items/:id → 200 for existing item", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/plugins/items/${FAKE_ID}`,
      headers: headers(["plugin_user"]),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(FAKE_ID);
    expect(body.name).toBe("test-plugin-item");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// REGISTRY ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Registry routes — auth boundary", () => {
  it("GET /v1/plugins → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/plugins" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/plugins → 403 wrong role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/plugins", headers: headers(["employee"]) });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/plugins/:id → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/plugins/${FAKE_ID}` });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/plugins/:id → 403 wrong role", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/plugins/${FAKE_ID}`, headers: headers(["employee"]) });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/plugins/install → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/plugins/install", payload: { manifestJson: {} } });
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/plugins/install → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/plugins/install",
      headers: headers(["plugin_user"]),
      payload: { manifestJson: {} },
    });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/plugins/:id/enable → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/plugins/${FAKE_ID}/enable` });
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/plugins/:id/enable → 403 wrong role", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/plugins/${FAKE_ID}/enable`, headers: headers(["employee"]) });
    expect(res.statusCode).toBe(403);
  });

  it("POST /v1/plugins/:id/disable → 401 without token", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/plugins/${FAKE_ID}/disable` });
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/plugins/:id/disable → 403 wrong role", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/plugins/${FAKE_ID}/disable`, headers: headers(["employee"]) });
    expect(res.statusCode).toBe(403);
  });

  it("DELETE /v1/plugins/:id → 401 without token", async () => {
    const res = await app.inject({ method: "DELETE", url: `/v1/plugins/${FAKE_ID}` });
    expect(res.statusCode).toBe(401);
  });

  it("DELETE /v1/plugins/:id → 403 wrong role", async () => {
    const res = await app.inject({ method: "DELETE", url: `/v1/plugins/${FAKE_ID}`, headers: headers(["employee"]) });
    expect(res.statusCode).toBe(403);
  });

  it("PUT /v1/plugins/:id/config → 401 without token", async () => {
    const res = await app.inject({ method: "PUT", url: `/v1/plugins/${FAKE_ID}/config`, payload: { config: {} } });
    expect(res.statusCode).toBe(401);
  });

  it("PUT /v1/plugins/:id/config → 403 wrong role", async () => {
    const res = await app.inject({
      method: "PUT", url: `/v1/plugins/${FAKE_ID}/config`,
      headers: headers(["employee"]),
      payload: { config: {} },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("Registry routes — validation (400)", () => {
  it("GET /v1/plugins/:id with non-uuid → 400", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/plugins/not-a-uuid",
      headers: headers(["plugin_admin"]),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("POST /v1/plugins/:id/enable with non-uuid → 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/plugins/not-a-uuid/enable",
      headers: headers(["plugin_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/plugins/:id/disable with non-uuid → 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/plugins/not-a-uuid/disable",
      headers: headers(["plugin_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("DELETE /v1/plugins/:id with non-uuid → 400", async () => {
    const res = await app.inject({
      method: "DELETE", url: "/v1/plugins/not-a-uuid",
      headers: headers(["plugin_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("PUT /v1/plugins/:id/config with non-uuid → 400", async () => {
    const res = await app.inject({
      method: "PUT", url: "/v1/plugins/not-a-uuid/config",
      headers: headers(["plugin_admin"]),
      payload: { config: {} },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PUT /v1/plugins/:id/config with missing config → 400", async () => {
    const res = await app.inject({
      method: "PUT", url: `/v1/plugins/${FAKE_ID}/config`,
      headers: headers(["plugin_admin"]),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("Registry routes — not found (404)", () => {
  it("GET /v1/plugins/:id for unknown → 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/plugins/99999999-9999-4000-8000-999999999999",
      headers: headers(["plugin_admin"]),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });
});

describe("Registry routes — happy paths", () => {
  it("GET /v1/plugins → 200 with list", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/plugins",
      headers: headers(["plugin_admin"]),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("GET /v1/plugins/:id → 200 for existing plugin", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/plugins/${FAKE_ID}`,
      headers: headers(["plugin_admin"]),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(FAKE_ID);
  });

  it("POST /v1/plugins/install → 202 accepted", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/plugins/install",
      headers: headers(["plugin_admin"]),
      payload: { manifestJson: { name: "new-plugin", version: "1.0.0" } },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("POST /v1/plugins/:id/enable → 202 accepted", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/plugins/${FAKE_ID}/enable`,
      headers: headers(["plugin_admin"]),
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("POST /v1/plugins/:id/disable → 202 accepted", async () => {
    const res = await app.inject({
      method: "POST", url: `/v1/plugins/${FAKE_ID}/disable`,
      headers: headers(["plugin_admin"]),
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("DELETE /v1/plugins/:id → 202 accepted", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/v1/plugins/${FAKE_ID}`,
      headers: headers(["plugin_admin"]),
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("PUT /v1/plugins/:id/config → 202 accepted", async () => {
    const res = await app.inject({
      method: "PUT", url: `/v1/plugins/${FAKE_ID}/config`,
      headers: headers(["plugin_admin"]),
      payload: { config: { key: "value" } },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// HOOKS ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Hooks routes — auth boundary", () => {
  it("POST /v1/plugins/hooks → 401 without token", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/plugins/hooks",
      payload: { pluginId: PLUGIN_ID, eventType: "x", handlerPath: "/y" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/plugins/hooks → 403 wrong role", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/plugins/hooks",
      headers: headers(["plugin_user"]),
      payload: { pluginId: PLUGIN_ID, eventType: "x", handlerPath: "/y" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/plugins/hooks → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/plugins/hooks" });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/plugins/hooks → 403 wrong role", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/plugins/hooks", headers: headers(["plugin_user"]) });
    expect(res.statusCode).toBe(403);
  });

  it("GET /v1/plugins/hooks/:id → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/plugins/hooks/${FAKE_ID}` });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/plugins/hooks/:id → 403 wrong role", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/plugins/hooks/${FAKE_ID}`, headers: headers(["plugin_user"]) });
    expect(res.statusCode).toBe(403);
  });

  it("DELETE /v1/plugins/hooks/:id → 401 without token", async () => {
    const res = await app.inject({ method: "DELETE", url: `/v1/plugins/hooks/${FAKE_ID}` });
    expect(res.statusCode).toBe(401);
  });

  it("DELETE /v1/plugins/hooks/:id → 403 wrong role", async () => {
    const res = await app.inject({ method: "DELETE", url: `/v1/plugins/hooks/${FAKE_ID}`, headers: headers(["plugin_user"]) });
    expect(res.statusCode).toBe(403);
  });
});

describe("Hooks routes — validation (400)", () => {
  it("POST /v1/plugins/hooks with non-uuid pluginId → 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/plugins/hooks",
      headers: headers(["plugin_admin"]),
      payload: { pluginId: "not-uuid", eventType: "x", handlerPath: "/y" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("POST /v1/plugins/hooks with empty eventType → 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/plugins/hooks",
      headers: headers(["plugin_admin"]),
      payload: { pluginId: PLUGIN_ID, eventType: "", handlerPath: "/y" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/plugins/hooks with empty handlerPath → 400", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/plugins/hooks",
      headers: headers(["plugin_admin"]),
      payload: { pluginId: PLUGIN_ID, eventType: "x", handlerPath: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/plugins/hooks/:id with non-uuid → 400", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/plugins/hooks/not-a-uuid",
      headers: headers(["plugin_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });

  it("DELETE /v1/plugins/hooks/:id with non-uuid → 400", async () => {
    const res = await app.inject({
      method: "DELETE", url: "/v1/plugins/hooks/not-a-uuid",
      headers: headers(["plugin_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("Hooks routes — not found (404)", () => {
  it("GET /v1/plugins/hooks/:id for unknown → 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/plugins/hooks/99999999-9999-4000-8000-999999999999",
      headers: headers(["plugin_admin"]),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });
});

describe("Hooks routes — happy paths", () => {
  it("POST /v1/plugins/hooks → 202 accepted", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/plugins/hooks",
      headers: headers(["plugin_admin"]),
      payload: { pluginId: PLUGIN_ID, eventType: "item.created", handlerPath: "/hooks/handler" },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
    expect(res.json().id).toBeDefined();
  });

  it("GET /v1/plugins/hooks → 200 with list", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/plugins/hooks",
      headers: headers(["plugin_admin"]),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("GET /v1/plugins/hooks/:id → 200 for existing hook", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/plugins/hooks/${FAKE_ID}`,
      headers: headers(["plugin_admin"]),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(FAKE_ID);
    expect(res.json().eventType).toBe("item.created");
  });

  it("DELETE /v1/plugins/hooks/:id → 202 accepted", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/v1/plugins/hooks/${FAKE_ID}`,
      headers: headers(["plugin_admin"]),
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// STORE ROUTES
// ══════════════════════════════════════════════════════════════════════════════
describe("Store routes — auth boundary", () => {
  it("GET /v1/plugins/:pluginId/store/:key → 401 without token", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/plugins/${PLUGIN_ID}/store/settings` });
    expect(res.statusCode).toBe(401);
  });

  it("GET /v1/plugins/:pluginId/store/:key → 403 wrong role", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/plugins/${PLUGIN_ID}/store/settings`,
      headers: headers(["employee"]),
    });
    expect(res.statusCode).toBe(403);
  });

  it("PUT /v1/plugins/:pluginId/store/:key → 401 without token", async () => {
    const res = await app.inject({
      method: "PUT", url: `/v1/plugins/${PLUGIN_ID}/store/settings`,
      payload: { value: "test" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("PUT /v1/plugins/:pluginId/store/:key → 403 wrong role", async () => {
    const res = await app.inject({
      method: "PUT", url: `/v1/plugins/${PLUGIN_ID}/store/settings`,
      headers: headers(["employee"]),
      payload: { value: "test" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("DELETE /v1/plugins/:pluginId/store/:key → 401 without token", async () => {
    const res = await app.inject({ method: "DELETE", url: `/v1/plugins/${PLUGIN_ID}/store/settings` });
    expect(res.statusCode).toBe(401);
  });

  it("DELETE /v1/plugins/:pluginId/store/:key → 403 wrong role", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/v1/plugins/${PLUGIN_ID}/store/settings`,
      headers: headers(["employee"]),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("Store routes — validation (400)", () => {
  it("GET /v1/plugins/:pluginId/store/:key with non-uuid pluginId → 400", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/plugins/not-uuid/store/settings",
      headers: headers(["plugin_admin"]),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_FAILED");
  });

  it("PUT /v1/plugins/:pluginId/store/:key with non-uuid pluginId → 400", async () => {
    const res = await app.inject({
      method: "PUT", url: "/v1/plugins/not-uuid/store/mykey",
      headers: headers(["plugin_admin"]),
      payload: { value: "test" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("DELETE /v1/plugins/:pluginId/store/:key with non-uuid pluginId → 400", async () => {
    const res = await app.inject({
      method: "DELETE", url: "/v1/plugins/not-uuid/store/mykey",
      headers: headers(["plugin_admin"]),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("Store routes — not found (404)", () => {
  it("GET /v1/plugins/:pluginId/store/:key for unknown key → 404", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/plugins/${PLUGIN_ID}/store/nonexistent-key`,
      headers: headers(["plugin_admin"]),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("DELETE /v1/plugins/:pluginId/store/:key for unknown key → 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/plugins/${PLUGIN_ID}/store/nonexistent-key`,
      headers: headers(["plugin_admin"]),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });
});

describe("Store routes — happy paths", () => {
  it("GET /v1/plugins/:pluginId/store/:key → 200 with entry data", async () => {
    const res = await app.inject({
      method: "GET", url: `/v1/plugins/${PLUGIN_ID}/store/settings`,
      headers: headers(["plugin_admin"]),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(body.data.key).toBe("settings");
    expect(body.data.value).toEqual({ theme: "dark" });
    expect(body.data.sizeBytes).toBe(18);
  });

  it("PUT /v1/plugins/:pluginId/store/:key → 202 enqueues value", async () => {
    const res = await app.inject({
      method: "PUT", url: `/v1/plugins/${PLUGIN_ID}/store/settings`,
      headers: headers(["plugin_admin"]),
      payload: { value: { theme: "light", fontSize: 14 } },
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data).toBeDefined();
    expect(body.data.key).toBe("settings");
    expect(body.data.sizeBytes).toBeGreaterThan(0);
    expect(body.data.status).toBe("accepted");
    expect(body.data.correlationId).toBeDefined();
  });

  it("DELETE /v1/plugins/:pluginId/store/:key → 202 enqueues delete", async () => {
    const res = await app.inject({
      method: "DELETE", url: `/v1/plugins/${PLUGIN_ID}/store/settings`,
      headers: headers(["plugin_admin"]),
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.data.key).toBe("settings");
    expect(body.data.status).toBe("accepted");
    expect(body.data.correlationId).toBeDefined();
  });
});
