import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils/intl-render";

/**
 * GAP-TENANT-ADMIN-ROLES-DETAIL-03 (FAILMASK): a failed fetch (5xx / network) must NOT
 * look like a deleted role. Only a genuine 404 renders the not-found page; any other
 * error shows a retryable error card.
 */
const { notFound, getAdminRoleById } = vi.hoisted(() => ({
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
  getAdminRoleById: vi.fn(),
}));
vi.mock("next/navigation", () => ({ notFound, useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("../../../../_data/loaders", () => ({ getAdminRoleById: (id: string) => getAdminRoleById(id) }));

import AdminRoleDetailPage from "./page";

describe("AdminRoleDetailPage — ROLES-DETAIL-03", () => {
  beforeEach(() => { notFound.mockClear(); getAdminRoleById.mockReset(); });

  it("a 500 shows the retry state, not 'not found'", async () => {
    getAdminRoleById.mockResolvedValue({ data: null, source: "error", status: 500 });
    render(await AdminRoleDetailPage({ params: Promise.resolve({ id: "r1" }) }));
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
    expect(notFound).not.toHaveBeenCalled();
  });

  it("a genuine 404 renders the not-found page", async () => {
    getAdminRoleById.mockResolvedValue({ data: null, source: "error", status: 404 });
    await expect(AdminRoleDetailPage({ params: Promise.resolve({ id: "r1" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });
});
