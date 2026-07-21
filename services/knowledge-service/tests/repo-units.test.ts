/**
 * Repo unit tests — pure functions and view mapping.
 * Tests toView, buildTree, and other non-DB logic.
 */
import { describe, it, expect, vi } from "vitest";

// Mock DB and infra to allow module import without real connections
const mockScopedRead = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
  const mockTx = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: (..._args: unknown[]) => ({
            limit: () => ({ offset: () => Promise.resolve([]) }),
            ...Promise.resolve([]),
            then: (resolve: (v: unknown[]) => void) => resolve([]),
          }),
          limit: () => Promise.resolve([]),
          then: (resolve: (v: unknown[]) => void) => resolve([]),
        }),
        orderBy: () => ({
          limit: () => ({ offset: () => Promise.resolve([]) }),
          then: (resolve: (v: unknown[]) => void) => resolve([]),
        }),
        then: (resolve: (v: unknown[]) => void) => resolve([]),
      }),
    }),
  };
  return fn(mockTx);
});

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: vi.fn(), select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
  sqlClient: { end: vi.fn() },
  scopedRead: (...args: unknown[]) => mockScopedRead(...args as [never]),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    getOrLoad: vi.fn(async (_k: string, loader: () => Promise<unknown>) => loader()),
    listOrLoad: vi.fn(async (_t: string, _r: string, _k: string, loader: () => Promise<unknown>) => loader()),
    makeKey: vi.fn((...args: string[]) => args.join(":")),
    put: vi.fn(),
    invalidate: vi.fn(),
    invalidateResource: vi.fn(),
  },
  queue: { publish: vi.fn(), subscribe: vi.fn() },
}));

import { toView as docToView } from "../src/modules/documents/repo.js";
import { toView as catToView, buildTree, listByTenant as catListByTenant, getById as catGetById, getChildren, getAncestors } from "../src/modules/categories/repo.js";
import { toView as shareToView, listByTenant as shareListByTenant, listByDocument, getById as shareGetById } from "../src/modules/sharing/repo.js";
import { toView as retToView, listByTenant as retListByTenant, getById as retGetById, listExpiring } from "../src/modules/retention/repo.js";
import { toView as verToView, listByDocument as verListByDocument, getById as verGetById, getLatestVersionNo } from "../src/modules/versions/repo.js";
import { toView as searchToView, listAllForTenant, fallbackDbSearch } from "../src/modules/search/repo.js";

// ─── Documents repo ──────────────────────────────────────────────────────────

describe("documents/repo — toView", () => {
  it("maps a row to DocumentView", () => {
    const row = {
      id: "d1", tenantId: "t1", title: "Test", category: "finance", status: "draft",
      tags: ["a", "b"], accessLevel: "internal", fileType: "pdf", fileSize: 1024,
      author: "Author", createdAt: new Date("2024-01-01"), updatedAt: new Date("2024-06-01"), version: 2,
      createdBy: "u1", updatedBy: "u1",
    };
    const view = docToView(row as never);
    expect(view.id).toBe("d1");
    expect(view.title).toBe("Test");
    expect(view.tags).toEqual(["a", "b"]);
    expect(view.accessLevel).toBe("internal");
    expect(view.version).toBe(2);
  });

  it("defaults accessLevel to internal when null", () => {
    const row = {
      id: "d2", tenantId: "t1", title: "X", category: "hr", status: "approved",
      tags: null, accessLevel: null, fileType: null, fileSize: null,
      author: null, createdAt: new Date(), updatedAt: new Date(), version: 1,
      createdBy: "u1", updatedBy: "u1",
    };
    const view = docToView(row as never);
    expect(view.tags).toEqual([]);
    expect(view.accessLevel).toBe("internal");
  });
});

// ─── Categories repo ─────────────────────────────────────────────────────────

describe("categories/repo — toView", () => {
  it("maps a row to CategoryView", () => {
    const row = {
      id: "c1", tenantId: "t1", parentId: null, name: "Finance", slug: "finance",
      description: "Fin docs", icon: "folder", sortOrder: 0,
      createdAt: new Date(), updatedAt: new Date(), createdBy: "u1", updatedBy: "u1", version: 1,
    };
    const view = catToView(row as never);
    expect(view.id).toBe("c1");
    expect(view.name).toBe("Finance");
    expect(view.icon).toBe("folder");
  });

  it("handles null icon", () => {
    const row = {
      id: "c2", tenantId: "t1", parentId: "c1", name: "Sub", slug: "sub",
      description: "", icon: null, sortOrder: 1,
      createdAt: new Date(), updatedAt: new Date(), createdBy: "u1", updatedBy: "u1", version: 1,
    };
    const view = catToView(row as never);
    expect(view.icon).toBeNull();
    expect(view.parentId).toBe("c1");
  });
});

describe("categories/repo — buildTree", () => {
  it("builds a tree from flat list", () => {
    const items = [
      { id: "1", tenantId: "t", parentId: null, name: "Root", slug: "root", description: "", icon: null, sortOrder: 0, createdAt: new Date(), updatedAt: new Date(), createdBy: "u", updatedBy: "u", version: 1 },
      { id: "2", tenantId: "t", parentId: "1", name: "Child", slug: "child", description: "", icon: null, sortOrder: 0, createdAt: new Date(), updatedAt: new Date(), createdBy: "u", updatedBy: "u", version: 1 },
      { id: "3", tenantId: "t", parentId: "1", name: "Child2", slug: "child2", description: "", icon: null, sortOrder: 1, createdAt: new Date(), updatedAt: new Date(), createdBy: "u", updatedBy: "u", version: 1 },
    ];
    const tree = buildTree(items as never);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.children).toHaveLength(2);
    expect(tree[0]!.children![0]!.name).toBe("Child");
    expect(tree[0]!.children![1]!.name).toBe("Child2");
  });

  it("returns empty array for empty input", () => {
    expect(buildTree([])).toEqual([]);
  });

  it("handles multiple roots", () => {
    const items = [
      { id: "a", tenantId: "t", parentId: null, name: "A", slug: "a", description: "", icon: null, sortOrder: 0, createdAt: new Date(), updatedAt: new Date(), createdBy: "u", updatedBy: "u", version: 1 },
      { id: "b", tenantId: "t", parentId: null, name: "B", slug: "b", description: "", icon: null, sortOrder: 1, createdAt: new Date(), updatedAt: new Date(), createdBy: "u", updatedBy: "u", version: 1 },
    ];
    const tree = buildTree(items as never);
    expect(tree).toHaveLength(2);
  });

  it("treats orphaned children as roots", () => {
    const items = [
      { id: "orphan", tenantId: "t", parentId: "missing", name: "Orphan", slug: "orphan", description: "", icon: null, sortOrder: 0, createdAt: new Date(), updatedAt: new Date(), createdBy: "u", updatedBy: "u", version: 1 },
    ];
    const tree = buildTree(items as never);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.name).toBe("Orphan");
  });
});

// ─── Sharing repo ────────────────────────────────────────────────────────────

describe("sharing/repo — toView", () => {
  it("maps a row to DocumentShareView", () => {
    const row = {
      id: "s1", tenantId: "t1", documentId: "doc-1", sharedWith: "user-2",
      permission: "view", expiresAt: new Date("2025-12-31"),
      createdAt: new Date(), updatedAt: new Date(), createdBy: "u1", updatedBy: "u1", version: 1,
    };
    const view = shareToView(row as never);
    expect(view.id).toBe("s1");
    expect(view.permission).toBe("view");
    expect(view.expiresAt).toBeInstanceOf(Date);
  });
});

// ─── Retention repo ──────────────────────────────────────────────────────────

describe("retention/repo — toView", () => {
  it("maps a row to RetentionPolicyView", () => {
    const row = {
      id: "r1", tenantId: "t1", name: "7-Year", categoryId: null,
      retentionYears: 7, retentionDays: 0, action: "archive",
      notifyBefore: 90, reminderMonths: 6,
      createdAt: new Date(), updatedAt: new Date(), createdBy: "u1", updatedBy: "u1", version: 1,
    };
    const view = retToView(row as never);
    expect(view.id).toBe("r1");
    expect(view.retentionYears).toBe(7);
    expect(view.action).toBe("archive");
  });
});

// ─── Versions repo ───────────────────────────────────────────────────────────

describe("versions/repo — toView", () => {
  it("maps a row to DocumentVersionView", () => {
    const row = {
      id: "v1", tenantId: "t1", documentId: "doc-1", versionNo: 3,
      s3Key: "docs/v3.pdf", sizeBytes: 2048, changeNote: "Updated",
      createdBy: "u1", createdAt: new Date(),
    };
    const view = verToView(row as never);
    expect(view.id).toBe("v1");
    expect(view.versionNo).toBe(3);
    expect(view.s3Key).toBe("docs/v3.pdf");
    expect(view.sizeBytes).toBe(2048);
  });
});

// ─── Search repo ─────────────────────────────────────────────────────────────

describe("search/repo — toView", () => {
  it("maps a row to SearchIndexView", () => {
    const row = {
      id: "si1", tenantId: "t1", documentId: "doc-1", title: "Budget",
      content: "Annual budget...", tags: ["finance", "annual"],
      status: "indexed", indexedAt: new Date(),
    };
    const view = searchToView(row as never);
    expect(view.id).toBe("si1");
    expect(view.title).toBe("Budget");
    expect(view.tags).toEqual(["finance", "annual"]);
  });

  it("defaults tags to empty array when null", () => {
    const row = {
      id: "si2", tenantId: "t1", documentId: "doc-2", title: "Min",
      content: "", tags: null, status: "pending", indexedAt: new Date(),
    };
    const view = searchToView(row as never);
    expect(view.tags).toEqual([]);
  });
});

// ─── Context (shared) ────────────────────────────────────────────────────────

describe("shared/context", () => {
  it("HttpError has correct properties", async () => {
    const { HttpError } = await import("../src/shared/context.js");
    const err = new HttpError(403, "FORBIDDEN", "not allowed");
    expect(err.status).toBe(403);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toBe("not allowed");
  });

  it("requireRole throws HttpError for missing roles", async () => {
    const { requireRole, HttpError } = await import("../src/shared/context.js");
    const ctx = { tenantId: "t1", actorId: "a1", roles: ["citizen"], correlationId: "c1" } as never;
    expect(() => requireRole(ctx, ["admin"])).toThrow(HttpError);
  });
});

// ─── Repo function calls (with mocked scopedRead) ────────────────────────────

describe("categories/repo — DB functions", () => {
  it("listByTenant calls scopedRead and returns empty array", async () => {
    const result = await catListByTenant("t1");
    expect(result).toEqual([]);
    expect(mockScopedRead).toHaveBeenCalled();
  });

  it("getById returns null for missing row", async () => {
    const result = await catGetById("t1", "missing-id");
    expect(result).toBeNull();
  });

  it("getChildren calls scopedRead", async () => {
    const result = await getChildren("t1", "parent-id");
    expect(result).toEqual([]);
  });

  it("getAncestors returns empty when no parent chain", async () => {
    const result = await getAncestors("t1", "id-with-no-ancestors");
    expect(result).toEqual([]);
  });
});

describe("sharing/repo — DB functions", () => {
  it("listByTenant returns empty", async () => {
    const result = await shareListByTenant("t1", 20, 0);
    expect(result).toEqual([]);
  });

  it("listByDocument returns empty", async () => {
    const result = await listByDocument("t1", "doc-1");
    expect(result).toEqual([]);
  });

  it("getById returns null for missing", async () => {
    const result = await shareGetById("t1", "missing");
    expect(result).toBeNull();
  });
});

describe("retention/repo — DB functions", () => {
  it("listByTenant returns empty", async () => {
    const result = await retListByTenant("t1", 20, 0);
    expect(result).toEqual([]);
  });

  it("getById returns null for missing", async () => {
    const result = await retGetById("t1", "missing");
    expect(result).toBeNull();
  });

  it("listExpiring returns empty", async () => {
    const result = await listExpiring("t1", 20, 0);
    expect(result).toEqual([]);
  });
});

describe("versions/repo — DB functions", () => {
  it("listByDocument returns empty", async () => {
    const result = await verListByDocument("t1", "doc-1", 20, 0);
    expect(result).toEqual([]);
  });

  it("getById returns null for missing", async () => {
    const result = await verGetById("t1", "missing");
    expect(result).toBeNull();
  });

  it("getLatestVersionNo returns 0 when no versions", async () => {
    const result = await getLatestVersionNo("t1", "doc-1");
    expect(result).toBe(0);
  });
});

describe("search/repo — DB functions", () => {
  it("listAllForTenant returns empty", async () => {
    const result = await listAllForTenant("t1");
    expect(result).toEqual([]);
  });
});
